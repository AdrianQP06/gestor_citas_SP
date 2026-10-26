import { Hono } from 'hono'
import { intQuery } from '../../http/helpers.ts'
import type { DB } from '../../shared/db.ts'
import { badRequest } from '../../shared/errors.ts'
import { DATE_RE } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { getAvailableDays, getAvailableSlots } from './availability.service.ts'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Disponibilidad vista por el personal (sin antelación mínima). Montado en /api/v1/availability. */
export function availabilityRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))

  app.get('/days', async (c) => {
    const month = c.req.query('month') ?? ''
    if (!MONTH_RE.test(month)) throw badRequest('Mes no válido (AAAA-MM).')
    const excludeId = c.req.query('excludeId') ? intQuery(c, 'excludeId', -1, 1, 1e9) : undefined
    return c.json({ days: await getAvailableDays(db, month, { audience: 'staff', ...(excludeId ? { excludeId } : {}) }) })
  })

  app.get('/slots', async (c) => {
    const date = c.req.query('date') ?? ''
    if (!DATE_RE.test(date)) throw badRequest('Fecha no válida.')
    const excludeId = c.req.query('excludeId') ? intQuery(c, 'excludeId', -1, 1, 1e9) : undefined
    return c.json({ slots: await getAvailableSlots(db, date, { audience: 'staff', ...(excludeId ? { excludeId } : {}) }) })
  })

  return app
}
