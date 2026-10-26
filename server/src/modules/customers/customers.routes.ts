import { Hono } from 'hono'
import { z } from 'zod'
import { body, intParam, intQuery, staffActor } from '../../http/helpers.ts'
import { audit } from '../../shared/audit.ts'
import { all, get, run, type DB } from '../../shared/db.ts'
import { conflict, notFound } from '../../shared/errors.ts'
import { localDateOf, nowUtc } from '../../shared/time.ts'
import { customerFieldsSchema } from '../appointments/appointments.schemas.ts'
import { listAppointments } from '../appointments/appointments.service.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { getSettings } from '../settings/settings.service.ts'

type CustomerRow = {
  id: number
  full_name: string
  phone: string
  email: string
  notes: string
  created_at: string
  total: number
  upcoming: number
  last_at: string | null
}

const toCustomer = (r: CustomerRow, tz: string) => ({
  id: r.id,
  fullName: r.full_name,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
  createdAt: r.created_at,
  totalAppointments: Number(r.total),
  upcomingAppointments: Number(r.upcoming),
  lastAppointmentDate: r.last_at ? localDateOf(r.last_at, tz) : null,
})

const CUSTOMER_SELECT = `SELECT c.id, c.full_name, c.phone, c.email, c.notes, c.created_at,
    (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id) AS total,
    (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status IN ('pending','confirmed') AND a.starts_at > $now) AS upcoming,
    (SELECT MAX(a.starts_at) FROM appointments a WHERE a.customer_id = c.id AND a.status != 'cancelled') AS last_at
  FROM customers c`

const customerUpdate = customerFieldsSchema.extend({ notes: z.string().trim().max(2000).default('') })

/** Directorio de clientes. Montado en /api/v1/customers (requiere sesión). */
export function customerRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))

  app.get('/', async (c) => {
    const tz = (await getSettings(db)).timezone
    const q = c.req.query('q')?.trim()
    const page = intQuery(c, 'page', 1)
    const pageSize = intQuery(c, 'pageSize', 20, 1, 100)
    // En MySQL la barra invertida es el carácter de escape por defecto de LIKE.
    const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null
    const where = like ? 'WHERE c.full_name LIKE $q OR c.email LIKE $q OR c.phone LIKE $q' : ''
    const total = Number(
      (await get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers c ${where}`, like ? { q: like } : {}))!.n
    )
    const rows = await all<CustomerRow>(
      db,
      `${CUSTOMER_SELECT} ${where} ORDER BY c.full_name, c.id LIMIT $limit OFFSET $offset`,
      { now: nowUtc().toISO()!, ...(like ? { q: like } : {}), limit: pageSize, offset: (page - 1) * pageSize }
    )
    return c.json({ total, items: rows.map((r) => toCustomer(r, tz)) })
  })

  app.get('/:id', async (c) => {
    const id = intParam(c, 'id')
    const tz = (await getSettings(db)).timezone
    const row = await get<CustomerRow>(db, `${CUSTOMER_SELECT} WHERE c.id = $id`, { id, now: nowUtc().toISO()! })
    if (!row) throw notFound('El cliente no existe.')
    const appointments = (await listAppointments(db, { customerId: id, sort: 'desc' })).items
    return c.json({ customer: toCustomer(row, tz), appointments })
  })

  app.patch('/:id', async (c) => {
    const id = intParam(c, 'id')
    const input = await body(c, customerUpdate)
    if (!(await get(db, 'SELECT id FROM customers WHERE id = $id', { id }))) throw notFound('El cliente no existe.')
    if (await get(db, 'SELECT id FROM customers WHERE email = $e AND id != $id', { e: input.email, id }))
      throw conflict('email_in_use', 'Ya existe otro cliente con ese correo electrónico.')
    await run(
      db,
      'UPDATE customers SET full_name = $n, phone = $p, email = $e, notes = $notes, updated_at = $now WHERE id = $id',
      { id, n: input.fullName, p: input.phone, e: input.email, notes: input.notes, now: nowUtc().toISO()! }
    )
    await audit(db, staffActor(c), 'customer.update', 'customer', id)
    const tz = (await getSettings(db)).timezone
    const row = (await get<CustomerRow>(db, `${CUSTOMER_SELECT} WHERE c.id = $id`, { id, now: nowUtc().toISO()! }))!
    return c.json({ customer: toCustomer(row, tz) })
  })

  return app
}
