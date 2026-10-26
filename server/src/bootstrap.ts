import { dbOptions } from './config/database.ts'
import { loadConfig } from './config/env.ts'
import { createProvider } from './integrations/whatsapp/whatsapp.provider.ts'
import { migrate, openDb, pendingMigrations } from './shared/db.ts'
import { configureLogger, log } from './shared/logger.ts'

/** Preparación común de los procesos (API y worker): configuración, log, base de datos y proveedor. */
export async function bootstrap(processName: string) {
  const config = loadConfig()
  configureLogger({ file: config.LOG_FILE })
  const db = openDb(dbOptions(config))

  try {
    if (config.AUTO_MIGRATE) {
      const ran = await migrate(db)
      if (ran.length) log.info('migrations_applied', { migrations: ran })
    } else {
      const pending = await pendingMigrations(db)
      if (pending.length) {
        log.error('migrations_pending', { pending, hint: 'Ejecuta `npm run migrate` antes de arrancar.' })
        process.exit(1)
      }
    }
  } catch (err) {
    log.error('database_unavailable', { error: (err as Error).message })
    process.exit(1)
  }

  const provider = createProvider(config)
  if (provider.name === 'test') {
    log.warn('whatsapp_test_mode', {
      process: processName,
      msg: 'WHATSAPP_PROVIDER=test: los recordatorios NO se envían a WhatsApp, solo se registran. Usa WHATSAPP_PROVIDER=meta para envíos reales.',
    })
  } else if (!provider.configured) {
    log.warn('whatsapp_not_configured', {
      process: processName,
      msg: 'Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID: los recordatorios quedan en cola.',
    })
  }
  if (config.NODE_ENV === 'production' && provider.name === 'test') {
    log.warn('production_with_test_whatsapp', { msg: 'Producción con WhatsApp en modo de prueba.' })
  }
  return { config, db, provider }
}
