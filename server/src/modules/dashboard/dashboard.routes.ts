import { Hono } from 'hono'
import type { DB } from '../../shared/db.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { dashboardSummary } from './dashboard.service.ts'

/** Resumen del panel. Montado en /api/v1/dashboard. */
export function dashboardRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))
  app.get('/', async (c) => c.json(await dashboardSummary(db)))
  return app
}
