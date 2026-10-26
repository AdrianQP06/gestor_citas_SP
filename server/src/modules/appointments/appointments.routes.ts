import { Hono } from 'hono'
import { z } from 'zod'
import { body, intParam, staffActor } from '../../http/helpers.ts'
import type { DB } from '../../shared/db.ts'
import { DATE_RE } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import {
  cancelSchema,
  rescheduleSchema,
  staffCreateSchema,
  staffUpdateSchema,
} from './appointments.schemas.ts'
import {
  STATUSES,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  updateDetails,
  type Status,
} from './appointments.service.ts'

const listQuery = z.object({
  from: z.string().regex(DATE_RE).optional(),
  to: z.string().regex(DATE_RE).optional(),
  status: z.string().optional(),
  q: z.string().max(100).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

/** Gestión de citas por el personal. Montado en /api/v1/appointments (requiere sesión). */
export function appointmentRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))

  app.get('/', async (c) => {
    const q = listQuery.parse(c.req.query())
    const statuses = q.status
      ?.split(',')
      .filter((s): s is Status => (STATUSES as readonly string[]).includes(s))
    return c.json(
      await listAppointments(db, {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(statuses?.length ? { statuses } : {}),
        ...(q.q ? { q: q.q } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        sort: q.sort ?? 'desc',
        page: q.page ?? 1,
        pageSize: q.pageSize ?? 20,
      })
    )
  })

  app.get('/:id', async (c) => c.json({ appointment: await getAppointment(db, intParam(c, 'id')) }))

  app.post('/', async (c) => {
    const input = await body(c, staffCreateSchema)
    const appt = await createAppointment(db, input, { audience: 'staff', actor: staffActor(c), userId: c.get('user').id })
    return c.json({ appointment: appt }, 201)
  })

  app.patch('/:id', async (c) => {
    const input = await body(c, staffUpdateSchema)
    return c.json({ appointment: await updateDetails(db, intParam(c, 'id'), input, staffActor(c)) })
  })

  app.post('/:id/confirm', async (c) =>
    c.json({ appointment: await confirmAppointment(db, intParam(c, 'id'), staffActor(c)) })
  )
  app.post('/:id/complete', async (c) =>
    c.json({ appointment: await completeAppointment(db, intParam(c, 'id'), staffActor(c)) })
  )

  app.post('/:id/cancel', async (c) => {
    const { reason } = await body(c, cancelSchema)
    return c.json({ appointment: await cancelAppointment(db, intParam(c, 'id'), 'staff', reason, staffActor(c)) })
  })

  app.post('/:id/reschedule', async (c) => {
    const slot = await body(c, rescheduleSchema)
    return c.json({
      appointment: await rescheduleAppointment(db, intParam(c, 'id'), slot, { audience: 'staff', actor: staffActor(c) }),
    })
  })

  return app
}
