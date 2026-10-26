import { processDueNotifications } from '../modules/notifications/notifications.service.ts'
import type { WhatsAppProvider } from '../integrations/whatsapp/whatsapp.provider.ts'
import type { DB } from '../shared/db.ts'
import { log } from '../shared/logger.ts'

/**
 * Tarea programada de recordatorios: cada `pollSeconds` procesa la cola persistente (tabla `notifications`).
 * No depende de ninguna petición HTTP ni del navegador, y puede ejecutarse en el mismo proceso que la API
 * o en un proceso aparte (`npm run worker`). Es segura frente a reinicios y a varias instancias: cada
 * envío se reclama de forma atómica y la cola impide duplicados (ver notifications.service.ts).
 */
export function startReminderWorker(db: DB, provider: WhatsAppProvider, pollSeconds: number): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await processDueNotifications(db, provider)
      if (r.sent || r.failed || r.retried) log.info('reminder_cycle', { ...r })
    } catch (err) {
      log.error('reminder_worker_error', { error: (err as Error).message })
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, pollSeconds * 1000)
  void tick()
  return () => clearInterval(timer)
}
