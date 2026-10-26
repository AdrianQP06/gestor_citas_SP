import { audit, type Actor } from '../../shared/audit.ts'
import { all, get, run, tx, type DB } from '../../shared/db.ts'
import { conflict, notFound } from '../../shared/errors.ts'
import { isoNow } from '../../shared/time.ts'
import type { SessionUser } from '../auth/auth.service.ts'
import { REASON_LABEL, STATUS_LABEL_SUPPORT, type SupportReason, type SupportStatus } from './support.schemas.ts'

/**
 * Solicitudes de atención al cliente.
 * La aplicación SOLO las guarda: no envía mensajes ni sabe si alguien llegó a contactar a la persona.
 * El equipo la contacta a mano (teléfono/WhatsApp) y marca el resultado:
 *   pending ─▶ attended (se contactó/atendió)     pending ─▶ closed (no se atiende: duplicada, sin respuesta…)
 * Ambos estados finales son definitivos y guardan quién, cuándo y una nota.
 */

type Row = {
  id: number
  full_name: string
  phone: string
  reason: SupportReason
  message: string | null
  status: SupportStatus
  consent_at: string
  created_at: string
  handled_at: string | null
  staff_note: string | null
  handled_by_name: string | null
}

const SELECT = `SELECT s.id, s.full_name, s.phone, s.reason, s.message, s.status, s.consent_at, s.created_at,
    s.handled_at, s.staff_note, u.name AS handled_by_name
  FROM support_requests s LEFT JOIN users u ON u.id = s.handled_by`

export function toView(r: Row) {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    reason: r.reason,
    reasonLabel: REASON_LABEL[r.reason],
    message: r.message,
    status: r.status,
    statusLabel: STATUS_LABEL_SUPPORT[r.status],
    consentAt: r.consent_at,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledBy: r.handled_by_name,
    staffNote: r.staff_note,
  }
}
export type SupportView = ReturnType<typeof toView>

/** Ventana en la que una segunda solicitud del mismo teléfono con otra aún pendiente no se duplica. */
const DEDUPE_HOURS = 24

/**
 * Guarda una solicitud del portal. Si ya hay una PENDIENTE del mismo número reciente, no crea otra
 * (evita inundar la bandeja) y devuelve el mismo resultado: la persona no necesita saberlo.
 */
export async function createSupportRequest(
  db: DB,
  input: { fullName: string; phone: string; reason: SupportReason; message?: string | undefined },
  actor: Actor
): Promise<{ created: boolean }> {
  const digits = input.phone.replace(/\D/g, '')
  return tx(db, async () => {
    const since = new Date(Date.now() - DEDUPE_HOURS * 3_600_000).toISOString()
    const open = await get<{ id: number }>(
      db,
      "SELECT id FROM support_requests WHERE phone_digits = $d AND status = 'pending' AND created_at >= $since LIMIT 1",
      { d: digits, since }
    )
    if (open) return { created: false }
    const now = isoNow()
    const info = await run(
      db,
      `INSERT INTO support_requests (full_name, phone, phone_digits, reason, message, status, consent_at, created_at, updated_at)
       VALUES ($n, $p, $d, $r, $m, 'pending', $now, $now, $now)`,
      { n: input.fullName, p: input.phone, d: digits, r: input.reason, m: input.message ?? null, now }
    )
    // Sin datos personales en el registro de actividad: solo el motivo.
    await audit(db, actor, 'support.create', 'support_request', info.lastInsertRowid, { reason: input.reason })
    return { created: true }
  })
}

export async function listSupportRequests(db: DB, status?: SupportStatus): Promise<SupportView[]> {
  const where = status ? 'WHERE s.status = $status' : ''
  const rows = await all<Row>(
    db,
    // Pendientes primero (las más antiguas arriba: llevan más tiempo esperando), luego el resto por fecha.
    `${SELECT} ${where} ORDER BY (s.status = 'pending') DESC, IF(s.status = 'pending', s.created_at, NULL) ASC, s.created_at DESC LIMIT 300`,
    status ? { status } : {}
  )
  return rows.map(toView)
}

export async function pendingSupportCount(db: DB): Promise<number> {
  const row = await get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM support_requests WHERE status = 'pending'")
  return Number(row?.n ?? 0)
}

async function resolve(db: DB, id: number, to: 'attended' | 'closed', note: string | undefined, user: SessionUser, actor: Actor) {
  return tx(db, async () => {
    const row = await get<Row>(db, `${SELECT} WHERE s.id = $id`, { id })
    if (!row) throw notFound('La solicitud no existe.')
    if (row.status !== 'pending') {
      throw conflict('invalid_state', `La solicitud ya está «${STATUS_LABEL_SUPPORT[row.status]}» y no admite más cambios.`)
    }
    const now = isoNow()
    const r = await run(
      db,
      `UPDATE support_requests SET status = $to, handled_by = $u, handled_at = $now, updated_at = $now, staff_note = $note
       WHERE id = $id AND status = 'pending'`,
      { to, u: user.id, now, note: note ?? null, id }
    )
    if (!r.changes) throw conflict('invalid_state', 'La solicitud cambió de estado mientras la gestionabas. Recarga e inténtalo de nuevo.')
    await audit(db, actor, to === 'attended' ? 'support.attend' : 'support.close', 'support_request', id)
    return toView((await get<Row>(db, `${SELECT} WHERE s.id = $id`, { id }))!)
  })
}

export const attendSupportRequest = (db: DB, id: number, note: string | undefined, user: SessionUser, actor: Actor) =>
  resolve(db, id, 'attended', note, user, actor)
export const closeSupportRequest = (db: DB, id: number, note: string, user: SessionUser, actor: Actor) =>
  resolve(db, id, 'closed', note, user, actor)
