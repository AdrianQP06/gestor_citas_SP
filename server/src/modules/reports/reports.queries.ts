import { all, get, type DB, type Params } from '../../shared/db.ts'
import { AppError } from '../../shared/errors.ts'
import type { ReportStatus } from './reports.types.ts'

/** Tope de seguridad: un informe nunca carga más filas que estas (memoria acotada). */
export const MAX_ROWS = 20_000

export type ApptRow = {
  id: number
  customer_id: number
  starts_at: string
  ends_at: string
  status: ReportStatus
  reason: string
  source: 'staff' | 'portal'
  cancelled_by: 'staff' | 'client' | null
  cancel_reason: string | null
  full_name: string
  phone: string
  email: string
}

export type RowFilter = {
  startUtc: string
  endUtc: string
  statuses: ReportStatus[]
  reason: string
}

/** Citas cuya fecha de inicio cae en [startUtc, endUtc) y cumplen los filtros de estado y motivo. */
export async function loadAppointments(db: DB, f: RowFilter): Promise<ApptRow[]> {
  const params: Params = { s: f.startUtc, e: f.endUtc, max: MAX_ROWS + 1 }
  const where = ['a.starts_at >= $s', 'a.starts_at < $e']
  if (f.statuses.length) {
    where.push(`a.status IN (${f.statuses.map((_, i) => `$st${i}`).join(', ')})`)
    f.statuses.forEach((s, i) => (params[`st${i}`] = s))
  }
  if (f.reason) {
    where.push('a.reason LIKE $reason')
    params.reason = `%${f.reason.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  }
  const rows = await all<ApptRow>(
    db,
    `SELECT a.id, a.customer_id, a.starts_at, a.ends_at, a.status, a.reason, a.source, a.cancelled_by, a.cancel_reason,
            c.full_name, c.phone, c.email
     FROM appointments a JOIN customers c ON c.id = a.customer_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.starts_at, a.id LIMIT $max`,
    params
  )
  if (rows.length > MAX_ROWS) {
    throw new AppError(
      422,
      'report_too_large',
      `El informe supera ${MAX_ROWS.toLocaleString('es-ES')} citas. Acota el período o añade filtros.`
    )
  }
  return rows
}

export type RescheduleEvent = {
  appointmentId: number
  at: string
  actor: string
  fromDate: string | null
  fromTime: string | null
  toDate: string | null
  toTime: string | null
}

/**
 * Cambios de horario registrados en el registro de actividad (audit_log) para esas citas.
 * Es la única fuente fiable de reprogramaciones: la tabla de citas solo guarda el horario actual.
 */
export async function loadReschedules(db: DB, appointmentIds: number[]): Promise<RescheduleEvent[]> {
  const out: RescheduleEvent[] = []
  for (let i = 0; i < appointmentIds.length; i += 500) {
    const chunk = appointmentIds.slice(i, i + 500)
    const params: Params = {}
    chunk.forEach((id, k) => (params[`i${k}`] = String(id)))
    const rows = await all<{ entity_id: string; created_at: string; actor: string; detail: string | null }>(
      db,
      `SELECT entity_id, created_at, actor, detail FROM audit_log
       WHERE action = 'appointment.reschedule' AND entity = 'appointment'
         AND entity_id IN (${chunk.map((_, k) => `$i${k}`).join(', ')})
       ORDER BY id`,
      params
    )
    for (const r of rows) {
      let d: { from?: { date?: string; time?: string }; to?: { date?: string; time?: string } } = {}
      try {
        d = r.detail ? JSON.parse(r.detail) : {}
      } catch {
        /* detalle ilegible: se cuenta el evento sin horarios */
      }
      out.push({
        appointmentId: Number(r.entity_id),
        at: r.created_at,
        actor: r.actor,
        fromDate: d.from?.date ?? null,
        fromTime: d.from?.time ?? null,
        toDate: d.to?.date ?? null,
        toTime: d.to?.time ?? null,
      })
    }
  }
  return out
}

/** Primera cita no cancelada registrada en el sistema (para saber si hay historial previo fiable). */
export async function earliestVisitStart(db: DB): Promise<string | null> {
  const row = await get<{ m: string | null }>(db, "SELECT MIN(starts_at) AS m FROM appointments WHERE status <> 'cancelled'")
  return row?.m ?? null
}

/** Clientes (de la lista dada) con alguna cita no cancelada anterior a `beforeUtc`. */
export async function customersWithPriorVisits(db: DB, customerIds: number[], beforeUtc: string): Promise<Set<number>> {
  const prior = new Set<number>()
  for (let i = 0; i < customerIds.length; i += 500) {
    const chunk = customerIds.slice(i, i + 500)
    const params: Params = { before: beforeUtc }
    chunk.forEach((id, k) => (params[`c${k}`] = id))
    const rows = await all<{ customer_id: number }>(
      db,
      `SELECT DISTINCT customer_id FROM appointments
       WHERE status <> 'cancelled' AND starts_at < $before AND customer_id IN (${chunk.map((_, k) => `$c${k}`).join(', ')})`,
      params
    )
    for (const r of rows) prior.add(r.customer_id)
  }
  return prior
}

export type OperationRow = {
  id: number
  code: string
  created_at: string
  type: 'deposit' | 'refund'
  product: 'daily' | 'master_business' | null
  amount_minor: number | string
  currency: string
  status: 'pending' | 'confirmed' | 'voided'
  reference: string | null
  appointment_id: number
  client_name: string
  created_name: string
}

/**
 * Operaciones registradas en [startUtc, endUtc) (por fecha de registro) y, opcionalmente, con ciertos estados.
 * Cada operación pertenece a UNA cita, UN cliente y UN usuario: los JOIN son muchos-a-uno, por lo que ninguna
 * operación (ni su importe) puede aparecer duplicada.
 */
export async function loadOperations(
  db: DB,
  f: { startUtc: string; endUtc: string; statuses: string[] }
): Promise<OperationRow[]> {
  const params: Params = { s: f.startUtc, e: f.endUtc, max: MAX_ROWS + 1 }
  const where = ['o.created_at >= $s', 'o.created_at < $e']
  if (f.statuses.length) {
    where.push(`o.status IN (${f.statuses.map((_, i) => `$st${i}`).join(', ')})`)
    f.statuses.forEach((s, i) => (params[`st${i}`] = s))
  }
  const rows = await all<OperationRow>(
    db,
    `SELECT o.id, o.code, o.created_at, o.type, o.product, o.amount_minor, o.currency, o.status, o.reference,
            a.id AS appointment_id, c.full_name AS client_name, u.name AS created_name
     FROM operations o
     JOIN appointments a ON a.id = o.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN users u ON u.id = o.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY o.created_at, o.id LIMIT $max`,
    params
  )
  if (rows.length > MAX_ROWS) {
    throw new AppError(422, 'report_too_large', `El informe supera ${MAX_ROWS.toLocaleString('es-ES')} operaciones. Acota el período.`)
  }
  return rows
}

/** Motivos más habituales (para sugerencias en el filtro). */
export async function topReasonOptions(db: DB, limit = 20): Promise<string[]> {
  const rows = await all<{ reason: string; n: number }>(
    db,
    'SELECT reason, COUNT(*) AS n FROM appointments GROUP BY reason ORDER BY n DESC, reason LIMIT $l',
    { l: limit }
  )
  return rows.map((r) => r.reason)
}
