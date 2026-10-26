import { Hono } from 'hono'
import { intQuery } from '../../http/helpers.ts'
import { all, type DB } from '../../shared/db.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'

/** Registro de actividad (solo administradores). Montado en /api/v1/audit. */
export function auditRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db, 'admin'))

  app.get('/', async (c) => {
    const limit = intQuery(c, 'limit', 100, 1, 500)
    const rows = await all<{
      id: number
      at: string
      actor: string
      action: string
      entity: string
      entity_id: string | null
      detail: string | null
    }>(
      db,
      'SELECT id, created_at AS at, actor, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT $limit',
      { limit }
    )
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        detail: r.detail ? JSON.parse(r.detail) : null,
      })),
    })
  })

  return app
}
