import type { DbOptions } from '../shared/db.ts'
import type { Config } from './env.ts'

/** Opciones de conexión a MySQL derivadas de la configuración. */
export function dbOptions(config: Config): DbOptions {
  return {
    url: config.DATABASE_URL,
    ssl: config.DATABASE_SSL,
    ...(config.DATABASE_SSL_CA ? { sslCa: config.DATABASE_SSL_CA } : {}),
    connectionLimit: config.DATABASE_POOL_SIZE,
  }
}
