import { DateTime } from 'luxon'
import { WhatsAppError, type WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider.ts'
import { audit, SYSTEM_ACTOR } from '../../shared/audit.ts'
import { all, get, run, type DB } from '../../shared/db.ts'
import { log } from '../../shared/logger.ts'
import { isoNow, localTimeOf, nowUtc } from '../../shared/time.ts'
import { getSettings } from '../settings/settings.service.ts'

export const MAX_ATTEMPTS = 4
const BACKOFF_SECONDS = [60, 120, 240]
const STUCK_AFTER_MINUTES = 5

type AppointmentRow = { id: number; starts_at: string; status: string }

/**
 * Sincroniza la cola de recordatorios de una cita con su estado actual:
 *  - cita activa y futura → un recordatorio por destinatario activo, programado `reminder_minutes` antes;
 *  - cita cancelada/pasada, destinatario inactivo o hora cambiada → los pendientes se cancelan.
 * La restricción UNIQUE (cita, destinatario, tipo, hora programada) evita duplicados.
 */
export async function reconcileAppointment(db: DB, appointmentId: number, now: DateTime = nowUtc()): Promise<void> {
  const appt = await get<AppointmentRow>(db, 'SELECT id, starts_at, status FROM appointments WHERE id = $id', {
    id: appointmentId,
  })
  if (!appt) return
  const nowIso = now.toISO()!
  const active = (appt.status === 'pending' || appt.status === 'confirmed') && appt.starts_at > nowIso
  const reminderMin = (await getSettings(db)).reminder_minutes
  const scheduledFor = DateTime.fromISO(appt.starts_at, { zone: 'utc' }).minus({ minutes: reminderMin }).toISO()!

  const recipients = active ? await all<{ id: number }>(db, 'SELECT id FROM notification_recipients WHERE active = 1') : []
  const wanted = new Set(recipients.map((r) => r.id))

  // Cancelar los recordatorios pendientes que ya no corresponden.
  const pending = await all<{ id: number; recipient_id: number; scheduled_for: string }>(
    db,
    "SELECT id, recipient_id, scheduled_for FROM notifications WHERE appointment_id = $a AND status = 'pending'",
    { a: appt.id }
  )
  for (const n of pending) {
    if (!wanted.has(n.recipient_id) || n.scheduled_for !== scheduledFor) {
      await run(
        db,
        "UPDATE notifications SET status = 'cancelled', updated_at = $now WHERE id = $id AND status = 'pending'",
        { id: n.id, now: nowIso }
      )
    }
  }

  // Programar los que faltan (o reactivar uno cancelado/caducado con la misma hora).
  // En MySQL las asignaciones de ON DUPLICATE KEY se evalúan en orden: `status` va la última para que
  // las demás condiciones vean todavía el estado anterior.
  for (const r of recipients) {
    await run(
      db,
      `INSERT INTO notifications (appointment_id, recipient_id, kind, scheduled_for, next_attempt_at, created_at, updated_at)
       VALUES ($a, $r, 'reminder', $s, $s, $ts, $ts)
       ON DUPLICATE KEY UPDATE
         attempts        = IF(status IN ('cancelled', 'expired'), 0, attempts),
         last_error      = IF(status IN ('cancelled', 'expired'), NULL, last_error),
         next_attempt_at = IF(status IN ('cancelled', 'expired'), VALUES(next_attempt_at), next_attempt_at),
         updated_at      = IF(status IN ('cancelled', 'expired'), $now, updated_at),
         status          = IF(status IN ('cancelled', 'expired'), 'pending', status)`,
      { a: appt.id, r: r.id, s: scheduledFor, now: nowIso, ts: isoNow() }
    )
  }
}

/** Reprograma todas las citas futuras (tras cambiar destinatarios o la antelación del aviso). */
export async function reconcileAllFuture(db: DB, now: DateTime = nowUtc()): Promise<void> {
  const rows = await all<{ id: number }>(
    db,
    "SELECT id FROM appointments WHERE starts_at > $now AND status IN ('pending', 'confirmed')",
    { now: now.toISO()! }
  )
  for (const r of rows) await reconcileAppointment(db, r.id, now)
  // Y cancela los pendientes de citas que ya no son futuras/activas.
  await run(
    db,
    `UPDATE notifications SET status = 'cancelled', updated_at = $now
     WHERE status = 'pending' AND appointment_id IN (
       SELECT id FROM appointments WHERE status NOT IN ('pending', 'confirmed') OR starts_at <= $now)`,
    { now: now.toISO()! }
  )
}

type DueRow = {
  id: number
  attempts: number
  appointment_id: number
  starts_at: string
  status: string
  reason: string
  full_name: string
  recipient_phone: string
  recipient_active: number
}

export type ProcessResult = { sent: number; failed: number; retried: number; expired: number }

/** Un ciclo del worker. Exportado para poder probarlo con un reloj controlado. */
export async function processDueNotifications(
  db: DB,
  provider: WhatsAppProvider,
  now: DateTime = nowUtc()
): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, failed: 0, retried: 0, expired: 0 }
  const nowIso = now.toISO()!

  // Recuperación: envíos que quedaron "en curso" por una caída del proceso.
  await run(
    db,
    `UPDATE notifications SET status = 'pending', updated_at = $now
     WHERE status = 'sending' AND updated_at < $stuck`,
    { now: nowIso, stuck: now.minus({ minutes: STUCK_AFTER_MINUTES }).toISO()! }
  )

  // Recordatorios que ya no tienen sentido: la cita empezó o dejó de estar activa.
  result.expired = (
    await run(
      db,
      `UPDATE notifications SET status = 'expired', last_error = 'La cita ya había comenzado.', updated_at = $now
       WHERE status = 'pending' AND appointment_id IN (SELECT id FROM appointments WHERE starts_at <= $now)`,
      { now: nowIso }
    )
  ).changes
  await run(
    db,
    `UPDATE notifications SET status = 'cancelled', updated_at = $now
     WHERE status = 'pending' AND appointment_id IN (SELECT id FROM appointments WHERE status NOT IN ('pending', 'confirmed'))`,
    { now: nowIso }
  )

  if (!provider.configured) return result // se queda en cola hasta que haya credenciales

  const due = await all<DueRow>(
    db,
    `SELECT n.id, n.attempts, a.id AS appointment_id, a.starts_at, a.status, a.reason, c.full_name,
            r.phone AS recipient_phone, r.active AS recipient_active
     FROM notifications n
     JOIN appointments a ON a.id = n.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN notification_recipients r ON r.id = n.recipient_id
     WHERE n.status = 'pending' AND n.next_attempt_at <= $now
     ORDER BY n.next_attempt_at LIMIT 25`,
    { now: nowIso }
  )

  const tz = (await getSettings(db)).timezone
  for (const n of due) {
    // Reclamo atómico: si otro proceso lo tomó antes, changes = 0 y lo saltamos.
    const claimed = (
      await run(
        db,
        "UPDATE notifications SET status = 'sending', attempts = attempts + 1, updated_at = $now WHERE id = $id AND status = 'pending'",
        { id: n.id, now: nowIso }
      )
    ).changes
    if (!claimed) continue

    if (!n.recipient_active) {
      await run(db, "UPDATE notifications SET status = 'cancelled', updated_at = $now WHERE id = $id", {
        id: n.id,
        now: nowIso,
      })
      continue
    }

    try {
      const sent = await provider.send({
        to: n.recipient_phone,
        clientName: n.full_name,
        time: localTimeOf(n.starts_at, tz),
        reason: n.reason,
      })
      await run(
        db,
        `UPDATE notifications SET status = 'sent', provider = $p, provider_message_id = $m, sent_at = $now,
           last_error = NULL, updated_at = $now WHERE id = $id`,
        { id: n.id, p: sent.provider, m: sent.messageId, now: isoNow() }
      )
      result.sent++
      log.info('reminder_sent', { notificationId: n.id, appointmentId: n.appointment_id, provider: sent.provider })
    } catch (err) {
      const message = (err as Error).message
      const retryable = err instanceof WhatsAppError ? err.retryable : true
      const attempts = n.attempts + 1
      const stillUseful = DateTime.fromISO(n.starts_at, { zone: 'utc' }) > now
      if (retryable && attempts < MAX_ATTEMPTS && stillUseful) {
        const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)]!
        await run(
          db,
          `UPDATE notifications SET status = 'pending', last_error = $e, next_attempt_at = $next, updated_at = $now WHERE id = $id`,
          { id: n.id, e: message, next: now.plus({ seconds: delay }).toISO()!, now: isoNow() }
        )
        result.retried++
        log.warn('reminder_retry', { notificationId: n.id, attempts, error: message })
      } else {
        await run(db, `UPDATE notifications SET status = 'failed', last_error = $e, updated_at = $now WHERE id = $id`, {
          id: n.id,
          e: message,
          now: isoNow(),
        })
        result.failed++
        log.error('reminder_failed', { notificationId: n.id, appointmentId: n.appointment_id, error: message })
        await audit(db, SYSTEM_ACTOR, 'reminder.failed', 'notification', n.id, { error: message })
      }
    }
  }
  return result
}

/** Reintento manual de un recordatorio fallido/caducado (siempre que la cita siga vigente). */
export async function retryNotification(db: DB, id: number, now: DateTime = nowUtc()): Promise<boolean> {
  const { changes } = await run(
    db,
    `UPDATE notifications SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = $now, updated_at = $now
     WHERE id = $id AND status IN ('failed', 'expired')
       AND appointment_id IN (SELECT id FROM appointments WHERE starts_at > $now AND status IN ('pending', 'confirmed'))`,
    { id, now: now.toISO()! }
  )
  return changes > 0
}
