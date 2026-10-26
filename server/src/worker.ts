import { bootstrap } from './bootstrap.ts'
import { startReminderWorker } from './jobs/reminder-worker.ts'
import { closeDb } from './shared/db.ts'
import { log } from './shared/logger.ts'

// Proceso independiente que solo ejecuta las tareas programadas (recordatorios de WhatsApp).
// Comparte la base de datos MySQL con la API; arranca con REMINDER_WORKER=false en la API.
const { config, db, provider } = await bootstrap('worker')

const stop = startReminderWorker(db, provider, config.REMINDER_POLL_SECONDS)
log.info('worker_started', { pollSeconds: config.REMINDER_POLL_SECONDS, whatsapp: provider.name })

function shutdown(signal: string) {
  log.info('worker_shutdown', { signal })
  stop()
  void closeDb(db).finally(() => process.exit(0))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (reason) => log.error('unhandled_rejection', { reason: String(reason) }))
