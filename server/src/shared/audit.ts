import { run, type DB } from './db.ts'
import { log } from './logger.ts'
import { isoNow } from './time.ts'

export type Actor = { label: string; ip?: string }

export const SYSTEM_ACTOR: Actor = { label: 'sistema' }
export const CLIENT_ACTOR = (ip?: string): Actor => ({ label: 'cliente (portal)', ...(ip ? { ip } : {}) })

/** Registra una operación importante en la tabla audit_log y en el log de la aplicación. */
export async function audit(
  db: DB,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await run(
      db,
      'INSERT INTO audit_log (actor, action, entity, entity_id, detail, ip, created_at) VALUES ($a, $ac, $e, $id, $d, $ip, $now)',
      {
        a: actor.label,
        ac: action,
        e: entity,
        id: entityId === null ? null : String(entityId),
        d: detail ? JSON.stringify(detail) : null,
        ip: actor.ip ?? null,
        now: isoNow(),
      }
    )
  } catch (err) {
    log.error('audit_failed', { action, error: (err as Error).message })
  }
  log.info('audit', { actor: actor.label, action, entity, entityId, ...detail })
}
