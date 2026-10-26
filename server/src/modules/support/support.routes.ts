import { Hono } from 'hono'
import { body, intParam, staffActor } from '../../http/helpers.ts'
import type { DB } from '../../shared/db.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { closeSupportSchema, handleSupportSchema, supportListQuerySchema } from './support.schemas.ts'
import {
  attendSupportRequest,
  closeSupportRequest,
  listSupportRequests,
  pendingSupportCount,
} from './support.service.ts'

/**
 * Bandeja interna de solicitudes de atención (montada en /api/v1/support-requests). Personal y administradores:
 * ven las mismas citas y clientes, así que ven las mismas solicitudes. El alta pública vive en el portal.
 */
export function supportRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))

  app.get('/', async (c) => {
    const { status } = supportListQuerySchema.parse(c.req.query())
    return c.json({ requests: await listSupportRequests(db, status), pending: await pendingSupportCount(db) })
  })

  app.get('/summary', async (c) => c.json({ pending: await pendingSupportCount(db) }))

  app.post('/:id/attend', async (c) => {
    const { note } = await body(c, handleSupportSchema)
    return c.json({ request: await attendSupportRequest(db, intParam(c, 'id'), note, c.get('user'), staffActor(c)) })
  })

  app.post('/:id/close', async (c) => {
    const { note } = await body(c, closeSupportSchema)
    return c.json({ request: await closeSupportRequest(db, intParam(c, 'id'), note, c.get('user'), staffActor(c)) })
  })

  return app
}
