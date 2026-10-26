import { randomInt } from 'node:crypto'
import { audit, type Actor } from '../../shared/audit.ts'
import { all, get, run, tx, type DB } from '../../shared/db.ts'
import { conflict, forbidden, notFound } from '../../shared/errors.ts'
import { isoNow, localDateOf, localTimeOf } from '../../shared/time.ts'
import type { SessionUser } from '../auth/auth.service.ts'
import { getSettings } from '../settings/settings.service.ts'
import { formatMoney, minorToDecimal } from './operations.money.ts'
import {
  METHOD,
  METHOD_LABEL,
  PRODUCT_LABEL,
  STATUS_LABEL_OP,
  TYPE_LABEL,
  type CreateOperationInput,
  type OperationStatus,
  type OperationType,
  type Product,
} from './operations.schemas.ts'

/**
 * Registro de operaciones (depósitos y reembolsos) de una cita.
 * OJO: solo deja constancia. No mueve dinero ni consulta pasarelas: un importe registrado no prueba que el
 * dinero se haya recibido o devuelto. «Confirmada» significa verificada por un administrador.
 *
 * Ciclo de vida (única fuente de verdad de las transiciones):
 *   pendiente ──confirmar (solo administrador)──► confirmada ──anular (solo administrador, con motivo)──► anulada
 *   pendiente ──anular (quien la registró o un administrador, con motivo)──► anulada
 *   anulada es terminal; una operación no se edita: se anula y se registra otra.
 */
export const TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  pending: ['confirmed', 'voided'],
  confirmed: ['voided'],
  voided: [],
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sin caracteres ambiguos (0/O, 1/I/L)

function newCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `SN-OP-${s}`
}

type Row = {
  id: number
  code: string
  appointment_id: number
  type: OperationType
  product: Product | null
  amount_minor: number | string
  currency: string
  method: 'cash'
  reference: string | null
  status: OperationStatus
  created_by: number
  created_at: string
  confirmed_by: number | null
  confirmed_at: string | null
  voided_by: number | null
  voided_at: string | null
  void_reason: string | null
  starts_at: string
  ends_at: string
  appt_reason: string
  client_name: string
  created_name: string
  confirmed_name: string | null
  voided_name: string | null
}

const SELECT = `SELECT o.id, o.code, o.appointment_id, o.type, o.product, o.amount_minor, o.currency, o.method, o.reference,
    o.status, o.created_by, o.created_at, o.confirmed_by, o.confirmed_at, o.voided_by, o.voided_at, o.void_reason,
    a.starts_at, a.ends_at, a.reason AS appt_reason, c.full_name AS client_name,
    cu.name AS created_name, xu.name AS confirmed_name, vu.name AS voided_name
  FROM operations o
  JOIN appointments a ON a.id = o.appointment_id
  JOIN customers c ON c.id = a.customer_id
  JOIN users cu ON cu.id = o.created_by
  LEFT JOIN users xu ON xu.id = o.confirmed_by
  LEFT JOIN users vu ON vu.id = o.voided_by`

export function toView(r: Row, tz: string) {
  const minor = Number(r.amount_minor)
  return {
    id: r.id,
    code: r.code,
    appointmentId: r.appointment_id,
    type: r.type,
    typeLabel: TYPE_LABEL[r.type],
    product: r.product,
    productLabel: r.product ? PRODUCT_LABEL[r.product] : null,
    amountMinor: minor,
    amount: minorToDecimal(minor),
    currency: r.currency,
    amountLabel: formatMoney(minor, r.currency),
    method: r.method,
    methodLabel: METHOD_LABEL,
    reference: r.reference,
    status: r.status,
    statusLabel: STATUS_LABEL_OP[r.status],
    createdAt: r.created_at,
    createdBy: { id: r.created_by, name: r.created_name },
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by ? { id: r.confirmed_by, name: r.confirmed_name ?? '' } : null,
    voidedAt: r.voided_at,
    voidedBy: r.voided_by ? { id: r.voided_by, name: r.voided_name ?? '' } : null,
    voidReason: r.void_reason,
    appointment: {
      id: r.appointment_id,
      date: localDateOf(r.starts_at, tz),
      time: localTimeOf(r.starts_at, tz),
      endTime: localTimeOf(r.ends_at, tz),
      reason: r.appt_reason,
      clientName: r.client_name,
    },
  }
}
export type OperationView = ReturnType<typeof toView>

type EventRow = {
  id: number
  occurred_at: string
  action: 'created' | 'confirmed' | 'voided'
  from_status: OperationStatus | null
  to_status: OperationStatus
  user_name: string
  actor: string
  note: string | null
}

export type OperationEventView = {
  id: number
  at: string
  action: EventRow['action']
  fromStatus: OperationStatus | null
  toStatus: OperationStatus
  userName: string
  note: string | null
}

async function getRow(db: DB, id: number): Promise<Row | undefined> {
  return get<Row>(db, `${SELECT} WHERE o.id = $id`, { id })
}

export async function listOperations(db: DB, appointmentId: number): Promise<OperationView[]> {
  const tz = (await getSettings(db)).timezone
  const rows = await all<Row>(db, `${SELECT} WHERE o.appointment_id = $a ORDER BY o.id DESC`, { a: appointmentId })
  return rows.map((r) => toView(r, tz))
}

export async function getEvents(db: DB, operationId: number): Promise<OperationEventView[]> {
  const rows = await all<EventRow>(
    db,
    `SELECT e.id, e.occurred_at, e.action, e.from_status, e.to_status, e.actor, e.note, u.name AS user_name
     FROM operation_events e JOIN users u ON u.id = e.user_id
     WHERE e.operation_id = $id ORDER BY e.id`,
    { id: operationId }
  )
  return rows.map((e) => ({
    id: e.id,
    at: e.occurred_at,
    action: e.action,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    userName: e.user_name,
    note: e.note,
  }))
}

export async function getOperation(db: DB, id: number): Promise<{ operation: OperationView; events: OperationEventView[] }> {
  const row = await getRow(db, id)
  if (!row) throw notFound('La operación no existe.')
  const tz = (await getSettings(db)).timezone
  return { operation: toView(row, tz), events: await getEvents(db, id) }
}

async function addEvent(
  db: DB,
  op: { id: number },
  e: { action: EventRow['action']; from: OperationStatus | null; to: OperationStatus; user: SessionUser; note?: string | null; at: string }
) {
  await run(
    db,
    `INSERT INTO operation_events (operation_id, occurred_at, action, from_status, to_status, user_id, actor, note)
     VALUES ($op, $at, $action, $from, $to, $uid, $actor, $note)`,
    { op: op.id, at: e.at, action: e.action, from: e.from, to: e.to, uid: e.user.id, actor: e.user.email, note: e.note ?? null }
  )
}

function isDuplicate(err: unknown) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ER_DUP_ENTRY'
}

/** Registra una operación SIEMPRE como pendiente de verificación y en efectivo. */
export async function createOperation(
  db: DB,
  input: CreateOperationInput,
  user: SessionUser,
  actor: Actor
): Promise<{ operation: OperationView; events: OperationEventView[] }> {
  const id = await tx(db, async () => {
    if (!(await get(db, 'SELECT id FROM appointments WHERE id = $id', { id: input.appointmentId }))) {
      throw notFound('La cita no existe.')
    }
    const now = isoNow()
    let insertedId = 0
    for (let attempt = 0; attempt < 6 && !insertedId; attempt++) {
      try {
        const r = await run(
          db,
          `INSERT INTO operations (code, appointment_id, type, product, amount_minor, currency, method, reference,
             status, created_by, created_at, updated_at)
           VALUES ($code, $a, $type, $product, $minor, $cur, $method, $ref, 'pending', $by, $now, $now)`,
          {
            code: newCode(),
            a: input.appointmentId,
            type: input.type,
            product: input.type === 'deposit' ? (input.product ?? null) : null,
            minor: input.amount,
            cur: input.currency,
            method: METHOD, // fijo en el backend, nunca el valor del cliente
            ref: input.reference?.trim() ? input.reference.trim() : null,
            by: user.id,
            now,
          }
        )
        insertedId = r.lastInsertRowid
      } catch (err) {
        if (!isDuplicate(err)) throw err // solo se reintenta una colisión de código
      }
    }
    if (!insertedId) throw conflict('code_collision', 'No se pudo generar un identificador único. Inténtalo de nuevo.')
    await addEvent(db, { id: insertedId }, { action: 'created', from: null, to: 'pending', user, at: now })
    await audit(db, actor, 'operation.create', 'operation', insertedId, {
      type: input.type,
      product: input.product ?? undefined,
      amountMinor: input.amount,
      currency: input.currency,
      appointmentId: input.appointmentId,
    })
    return insertedId
  })
  return getOperation(db, id)
}

function assertTransition(from: OperationStatus, to: OperationStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw conflict(
      'invalid_state',
      from === 'voided'
        ? 'La operación está anulada y no admite más cambios.'
        : `No se puede pasar de «${STATUS_LABEL_OP[from]}» a «${STATUS_LABEL_OP[to]}».`
    )
  }
}

/** Confirmar (verificar) una operación: reservado a administradores. */
export async function confirmOperation(db: DB, id: number, user: SessionUser, actor: Actor) {
  if (user.role !== 'admin') throw forbidden('Solo un administrador puede confirmar una operación.')
  await tx(db, async () => {
    const op = await getRow(db, id)
    if (!op) throw notFound('La operación no existe.')
    assertTransition(op.status, 'confirmed')
    const now = isoNow()
    const r = await run(
      db,
      `UPDATE operations SET status = 'confirmed', confirmed_by = $u, confirmed_at = $now, updated_at = $now
       WHERE id = $id AND status = 'pending'`,
      { id, u: user.id, now }
    )
    if (!r.changes) throw conflict('invalid_state', 'La operación cambió de estado mientras la confirmabas. Recarga e inténtalo de nuevo.')
    await addEvent(db, op, { action: 'confirmed', from: 'pending', to: 'confirmed', user, at: now })
    await audit(db, actor, 'operation.confirm', 'operation', id, { code: op.code })
  })
  return getOperation(db, id)
}

/**
 * Anular una operación (con motivo obligatorio). Una pendiente la puede anular quien la registró o un
 * administrador; una confirmada, solo un administrador. La anulación nunca borra el registro.
 */
export async function voidOperation(db: DB, id: number, reason: string, user: SessionUser, actor: Actor) {
  await tx(db, async () => {
    const op = await getRow(db, id)
    if (!op) throw notFound('La operación no existe.')
    assertTransition(op.status, 'voided')
    const allowed = user.role === 'admin' || (op.status === 'pending' && op.created_by === user.id)
    if (!allowed) {
      throw forbidden(
        op.status === 'confirmed'
          ? 'Solo un administrador puede anular una operación confirmada.'
          : 'Solo quien registró la operación o un administrador puede anularla.'
      )
    }
    const now = isoNow()
    const r = await run(
      db,
      `UPDATE operations SET status = 'voided', voided_by = $u, voided_at = $now, void_reason = $reason, updated_at = $now
       WHERE id = $id AND status = $from`,
      { id, u: user.id, now, reason, from: op.status }
    )
    if (!r.changes) throw conflict('invalid_state', 'La operación cambió de estado mientras la anulabas. Recarga e inténtalo de nuevo.')
    await addEvent(db, op, { action: 'voided', from: op.status, to: 'voided', user, note: reason, at: now })
    await audit(db, actor, 'operation.void', 'operation', id, { code: op.code, from: op.status, reason })
  })
  return getOperation(db, id)
}
