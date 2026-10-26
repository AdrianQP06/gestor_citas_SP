import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import type { z } from 'zod'
import { audit, type Actor } from '../../shared/audit.ts'
import { all, get, run, tx, type DB, type Params } from '../../shared/db.ts'
import { AppError, conflict, forbidden, notFound } from '../../shared/errors.ts'
import { dayBoundsUtc, isoNow, localDateOf, localTimeOf, nowUtc } from '../../shared/time.ts'
import { assertSlotBookable, type Audience } from '../availability/availability.service.ts'
import { reconcileAppointment } from '../notifications/notifications.service.ts'
import { getSettings, type Settings } from '../settings/settings.service.ts'
import type { staffCreateSchema, staffUpdateSchema } from './appointments.schemas.ts'

export const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const
export type Status = (typeof STATUSES)[number]

/** Citas que ocupan agenda (bloquean horario). */
export const ACTIVE_STATUSES: Status[] = ['pending', 'confirmed']

const MAX_PORTAL_UPCOMING_PER_EMAIL = 3

// ---------------------------------------------------------------- lectura

type Row = {
  id: number
  public_token: string
  customer_id: number
  starts_at: string
  ends_at: string
  reason: string
  internal_notes: string
  status: Status
  source: 'staff' | 'portal'
  cancelled_by: 'staff' | 'client' | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
  full_name: string
  phone: string
  email: string
}

const SELECT = `SELECT a.id, a.public_token, a.customer_id, a.starts_at, a.ends_at, a.reason, a.internal_notes,
    a.status, a.source, a.cancelled_by, a.cancel_reason, a.created_at, a.updated_at,
    c.full_name, c.phone, c.email
  FROM appointments a JOIN customers c ON c.id = a.customer_id`

export function toView(r: Row, tz: string) {
  return {
    id: r.id,
    publicToken: r.public_token,
    status: r.status,
    source: r.source,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    date: localDateOf(r.starts_at, tz),
    time: localTimeOf(r.starts_at, tz),
    endTime: localTimeOf(r.ends_at, tz),
    reason: r.reason,
    internalNotes: r.internal_notes,
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
    customer: { id: r.customer_id, fullName: r.full_name, phone: r.phone, email: r.email },
  }
}
export type AppointmentView = ReturnType<typeof toView>

export function getAppointmentRow(db: DB, id: number): Promise<Row | undefined> {
  return get<Row>(db, `${SELECT} WHERE a.id = $id`, { id })
}

export async function getAppointment(db: DB, id: number): Promise<AppointmentView> {
  const r = await getAppointmentRow(db, id)
  if (!r) throw notFound('La cita no existe.')
  return toView(r, (await getSettings(db)).timezone)
}

export function getByToken(db: DB, token: string): Promise<Row | undefined> {
  return get<Row>(db, `${SELECT} WHERE a.public_token = $t`, { t: token })
}

export type ListFilters = {
  from?: string
  to?: string
  statuses?: Status[]
  q?: string
  customerId?: number
  sort?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export async function listAppointments(db: DB, f: ListFilters) {
  const tz = (await getSettings(db)).timezone
  const where: string[] = []
  const params: Params = {}
  if (f.from) {
    where.push('a.starts_at >= $from')
    params.from = dayBoundsUtc(f.from, tz).start
  }
  if (f.to) {
    where.push('a.starts_at < $to')
    params.to = dayBoundsUtc(f.to, tz).end
  }
  if (f.statuses?.length) {
    where.push(`a.status IN (${f.statuses.map((_, i) => `$st${i}`).join(', ')})`)
    f.statuses.forEach((s, i) => (params[`st${i}`] = s))
  }
  if (f.customerId) {
    where.push('a.customer_id = $cust')
    params.cust = f.customerId
  }
  if (f.q?.trim()) {
    // En MySQL la barra invertida es el carácter de escape por defecto de LIKE.
    const like = `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    where.push('(c.full_name LIKE $q OR c.email LIKE $q OR c.phone LIKE $q OR a.reason LIKE $q)')
    params.q = like
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (
    await get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM appointments a JOIN customers c ON c.id = a.customer_id ${clause}`,
      params
    )
  )!.n
  const dir = f.sort === 'desc' ? 'DESC' : 'ASC'
  // Desempate por id para que la paginación sea estable.
  let sql = `${SELECT} ${clause} ORDER BY a.starts_at ${dir}, a.id ${dir}`
  if (f.pageSize) {
    const page = Math.max(1, f.page ?? 1)
    sql += ' LIMIT $limit OFFSET $offset'
    params.limit = f.pageSize
    params.offset = (page - 1) * f.pageSize
  }
  return { total: Number(total), items: (await all<Row>(db, sql, params)).map((r) => toView(r, tz)) }
}

// ---------------------------------------------------------------- escritura

function newToken() {
  return randomBytes(24).toString('base64url')
}

async function upsertCustomer(db: DB, c: { fullName: string; phone: string; email: string }): Promise<number> {
  const existing = await get<{ id: number }>(db, 'SELECT id FROM customers WHERE email = $e', { e: c.email })
  if (existing) {
    await run(db, 'UPDATE customers SET full_name = $n, phone = $p, updated_at = $now WHERE id = $id', {
      id: existing.id,
      n: c.fullName,
      p: c.phone,
      now: nowUtc().toISO()!,
    })
    return existing.id
  }
  const info = await run(db, 'INSERT INTO customers (full_name, phone, email, created_at, updated_at) VALUES ($n, $p, $e, $ts, $ts)', {
    n: c.fullName,
    p: c.phone,
    e: c.email,
    ts: isoNow(),
  })
  return info.lastInsertRowid
}

function slotConflict(message: string) {
  return conflict('slot_unavailable', message)
}

function isUniqueViolation(err: unknown) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY'
}

export type CreateInput = z.infer<typeof staffCreateSchema>

export async function createAppointment(
  db: DB,
  input: CreateInput,
  ctx: { audience: Audience; actor: Actor; userId?: number; now?: DateTime }
): Promise<AppointmentView> {
  const settings = await getSettings(db)
  try {
    const id = await tx(db, async () => {
      const slot = await assertSlotBookable(db, input.date, input.time, {
        audience: ctx.audience,
        settings,
        ...(ctx.now ? { now: ctx.now } : {}),
      })
      if ('reason' in slot && slot.reason) throw slotConflict(slot.message)

      if (ctx.audience === 'public') {
        const upcoming = (
          await get<{ n: number }>(
            db,
            `SELECT COUNT(*) AS n FROM appointments a JOIN customers c ON c.id = a.customer_id
             WHERE c.email = $e AND a.source = 'portal' AND a.status IN ('pending', 'confirmed') AND a.starts_at > $now`,
            { e: input.email, now: (ctx.now ?? nowUtc()).toISO()! }
          )
        )!.n
        if (Number(upcoming) >= MAX_PORTAL_UPCOMING_PER_EMAIL) {
          throw new AppError(
            409,
            'too_many_upcoming',
            `Ya tienes ${MAX_PORTAL_UPCOMING_PER_EMAIL} citas próximas. Cancela o modifica una de ellas para reservar otra.`
          )
        }
      }

      const customerId = await upsertCustomer(db, input)
      const status: Status =
        ctx.audience === 'public' ? (settings.auto_confirm ? 'confirmed' : 'pending') : input.status
      const info = await run(
        db,
        `INSERT INTO appointments (public_token, customer_id, starts_at, ends_at, reason, internal_notes, status, source, created_by, created_at, updated_at)
         VALUES ($tok, $cust, $s, $e, $reason, $notes, $status, $source, $by, $ts, $ts)`,
        {
          tok: newToken(),
          cust: customerId,
          s: (slot as { startsAt: string }).startsAt,
          e: (slot as { endsAt: string }).endsAt,
          reason: input.reason,
          notes: ctx.audience === 'staff' ? input.internalNotes : '',
          status,
          source: ctx.audience === 'staff' ? 'staff' : 'portal',
          by: ctx.userId ?? null,
          ts: isoNow(),
        }
      )
      const apptId = info.lastInsertRowid
      await reconcileAppointment(db, apptId, ctx.now)
      await audit(db, ctx.actor, 'appointment.create', 'appointment', apptId, {
        date: input.date,
        time: input.time,
        status,
      })
      return apptId
    })
    return await getAppointment(db, id)
  } catch (err) {
    if (isUniqueViolation(err) && /active_start/.test((err as Error).message))
      throw slotConflict('Ese horario ya está ocupado. Elige otro, por favor.')
    throw err
  }
}

async function mustGet(db: DB, id: number) {
  const r = await getAppointmentRow(db, id)
  if (!r) throw notFound('La cita no existe.')
  return r
}

export async function updateDetails(
  db: DB,
  id: number,
  input: z.infer<typeof staffUpdateSchema>,
  actor: Actor
): Promise<AppointmentView> {
  await tx(db, async () => {
    const r = await mustGet(db, id)
    if (input.fullName || input.phone || input.email) {
      const email = input.email ?? r.email
      if (email.toLowerCase() !== r.email.toLowerCase()) {
        const taken = await get(db, 'SELECT id FROM customers WHERE email = $e AND id != $id', {
          e: email,
          id: r.customer_id,
        })
        if (taken) throw conflict('email_in_use', 'Ya existe otro cliente con ese correo electrónico.')
      }
      await run(db, 'UPDATE customers SET full_name = $n, phone = $p, email = $e, updated_at = $now WHERE id = $id', {
        id: r.customer_id,
        n: input.fullName ?? r.full_name,
        p: input.phone ?? r.phone,
        e: email,
        now: nowUtc().toISO()!,
      })
    }
    await run(db, 'UPDATE appointments SET reason = $r, internal_notes = $n, updated_at = $now WHERE id = $id', {
      id,
      r: input.reason ?? r.reason,
      n: input.internalNotes ?? r.internal_notes,
      now: nowUtc().toISO()!,
    })
    await audit(db, actor, 'appointment.update', 'appointment', id)
  })
  return getAppointment(db, id)
}

async function setStatus(db: DB, id: number, status: Status, extra: { by?: string; why?: string | null } = {}) {
  await run(
    db,
    `UPDATE appointments SET status = $status, updated_at = $now,
       cancelled_by = $by, cancel_reason = $why WHERE id = $id`,
    { id, status, now: nowUtc().toISO()!, by: extra.by ?? null, why: extra.why ?? null }
  )
}

export async function confirmAppointment(db: DB, id: number, actor: Actor): Promise<AppointmentView> {
  await tx(db, async () => {
    const r = await mustGet(db, id)
    if (r.status !== 'pending') throw conflict('invalid_state', 'Solo se pueden confirmar citas pendientes.')
    await setStatus(db, id, 'confirmed')
    await reconcileAppointment(db, id)
    await audit(db, actor, 'appointment.confirm', 'appointment', id)
  })
  return getAppointment(db, id)
}

export async function completeAppointment(db: DB, id: number, actor: Actor): Promise<AppointmentView> {
  await tx(db, async () => {
    const r = await mustGet(db, id)
    if (r.status !== 'confirmed' && r.status !== 'pending')
      throw conflict('invalid_state', 'Solo se pueden completar citas activas.')
    if (r.starts_at > nowUtc().toISO()!) throw conflict('invalid_state', 'La cita aún no ha comenzado.')
    await setStatus(db, id, 'completed')
    await reconcileAppointment(db, id)
    await audit(db, actor, 'appointment.complete', 'appointment', id)
  })
  return getAppointment(db, id)
}

export async function cancelAppointment(
  db: DB,
  id: number,
  by: 'staff' | 'client',
  reason: string,
  actor: Actor
): Promise<AppointmentView> {
  await tx(db, async () => {
    const r = await mustGet(db, id)
    if (!ACTIVE_STATUSES.includes(r.status)) throw conflict('invalid_state', 'Esta cita ya no se puede cancelar.')
    await setStatus(db, id, 'cancelled', { by, why: reason || null })
    await reconcileAppointment(db, id)
    await audit(db, actor, 'appointment.cancel', 'appointment', id, { by, reason })
  })
  return getAppointment(db, id)
}

export async function rescheduleAppointment(
  db: DB,
  id: number,
  slot: { date: string; time: string },
  ctx: { audience: Audience; actor: Actor; now?: DateTime }
): Promise<AppointmentView> {
  const settings = await getSettings(db)
  try {
    await tx(db, async () => {
      const r = await mustGet(db, id)
      if (!ACTIVE_STATUSES.includes(r.status)) throw conflict('invalid_state', 'Esta cita ya no se puede reprogramar.')
      const found = await assertSlotBookable(db, slot.date, slot.time, {
        audience: ctx.audience,
        excludeId: id,
        settings,
        ...(ctx.now ? { now: ctx.now } : {}),
      })
      if ('reason' in found && found.reason) throw slotConflict(found.message)
      const status: Status =
        ctx.audience === 'public' && r.status === 'confirmed' && !settings.auto_confirm ? 'pending' : r.status
      await run(
        db,
        'UPDATE appointments SET starts_at = $s, ends_at = $e, status = $st, updated_at = $now WHERE id = $id',
        {
          id,
          s: (found as { startsAt: string }).startsAt,
          e: (found as { endsAt: string }).endsAt,
          st: status,
          now: nowUtc().toISO()!,
        }
      )
      await reconcileAppointment(db, id, ctx.now)
      await audit(db, ctx.actor, 'appointment.reschedule', 'appointment', id, {
        from: { date: localDateOf(r.starts_at, settings.timezone), time: localTimeOf(r.starts_at, settings.timezone) },
        to: slot,
      })
    })
  } catch (err) {
    if (isUniqueViolation(err) && /active_start/.test((err as Error).message))
      throw slotConflict('Ese horario ya está ocupado. Elige otro, por favor.')
    throw err
  }
  return getAppointment(db, id)
}

// ---------------------------------------------------------------- reglas del portal

export type ClientAction = 'cancel' | 'reschedule'

/** ¿Puede el cliente cancelar/reprogramar esta cita con las reglas configuradas? */
export function clientChangeRule(
  settings: Settings,
  appt: { status: Status; starts_at: string },
  action: ClientAction,
  now: DateTime = nowUtc()
): { allowed: true } | { allowed: false; reason: string } {
  if (!ACTIVE_STATUSES.includes(appt.status))
    return { allowed: false, reason: 'Esta cita ya no admite cambios.' }
  const enabled = action === 'cancel' ? settings.allow_client_cancel : settings.allow_client_reschedule
  if (!enabled) {
    return {
      allowed: false,
      reason: `Para ${action === 'cancel' ? 'cancelar' : 'reprogramar'} esta cita, contacta directamente con ${settings.business_name}.`,
    }
  }
  const deadline = DateTime.fromISO(appt.starts_at, { zone: 'utc' }).minus({ hours: settings.client_change_notice_hours })
  if (now > deadline) {
    return {
      allowed: false,
      reason: `Los cambios online se pueden hacer hasta ${settings.client_change_notice_hours} h antes de la cita. Contacta con ${settings.business_name}.`,
    }
  }
  return { allowed: true }
}

export async function assertClientCan(db: DB, row: Row, action: ClientAction): Promise<void> {
  const rule = clientChangeRule(await getSettings(db), row, action)
  if (!rule.allowed) throw forbidden(rule.reason)
}
