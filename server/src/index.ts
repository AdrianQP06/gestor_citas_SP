import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { bootstrap } from './bootstrap.ts'
import { startReminderWorker } from './jobs/reminder-worker.ts'
import { closeDb } from './shared/db.ts'
import { log } from './shared/logger.ts'

// Proceso de la API HTTP. Si REMINDER_WORKER=true también ejecuta el worker de recordatorios en el
// mismo proceso (cómodo en desarrollo); en producción se recomienda `npm run worker` como servicio aparte.
const { config, db, provider } = await bootstrap('api')

const here = dirname(fileURLToPath(import.meta.url))
const webDist = resolve(here, '..', '..', 'web', 'dist')
const app = createApp({ db, config, provider, webDist })

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  log.info('server_started', { port: info.port, host: config.HOST, env: config.NODE_ENV, whatsapp: provider.name })
})

const stopWorker = config.REMINDER_WORKER ? startReminderWorker(db, provider, config.REMINDER_POLL_SECONDS) : () => {}

function shutdown(signal: string) {
  log.info('shutdown', { signal })
  stopWorker()
  server.close(() => {
    void closeDb(db).finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (reason) => log.error('unhandled_rejection', { reason: String(reason) }))
