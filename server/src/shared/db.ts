import { AsyncLocalStorage } from 'node:async_hooks'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql, { type Pool, type PoolConnection, type PoolOptions, type ResultSetHeader } from 'mysql2/promise'

export type Param = string | number | boolean | null
export type Params = Record<string, Param>

/** Manejador de base de datos (pool de MySQL/MariaDB). */
export type DB = { pool: Pool }

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export type DbOptions = {
  /** mysql://usuario:contraseña@host:3306/base */
  url: string
  /** TLS con verificación de certificado (necesario con MySQL gestionado de DigitalOcean). */
  ssl?: boolean
  /** Ruta a la CA del servidor (opcional con ssl). */
  sslCa?: string
  connectionLimit?: number
}

export function openDb(opts: DbOptions): DB {
  const url = new URL(opts.url)
  const config: PoolOptions = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    charset: 'utf8mb4',
    connectionLimit: opts.connectionLimit ?? 10,
    namedPlaceholders: true,
    // affectedRows = filas que cumplen el WHERE (no solo las que cambian de valor).
    flags: ['+FOUND_ROWS'],
    // Todas las fechas son texto ISO UTC: no hay conversiones de zona en el driver.
    dateStrings: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    ...(opts.ssl
      ? { ssl: { rejectUnauthorized: true, ...(opts.sslCa ? { ca: readFileSync(opts.sslCa, 'utf8') } : {}) } }
      : {}),
  }
  return { pool: mysql.createPool(config) }
}

export async function closeDb(db: DB): Promise<void> {
  await db.pool.end()
}

// ---------------------------------------------------------------- consultas

/** Conexión de la transacción activa (si la hay) para esta base de datos. */
const txStore = new AsyncLocalStorage<{ pool: Pool; conn: PoolConnection }>()

type Executor = Pick<Pool, 'query'>

function executor(db: DB): Executor {
  const active = txStore.getStore()
  return active && active.pool === db.pool ? active.conn : db.pool
}

/** Convierte los marcadores `$nombre` de las consultas a los `:nombre` que entiende el driver. */
const named = (sql: string) => sql.replace(/\$([A-Za-z_]\w*)/g, ':$1')

export async function all<T = Record<string, unknown>>(db: DB, sql: string, params: Params = {}): Promise<T[]> {
  const [rows] = await executor(db).query({ sql: named(sql) }, params)
  return rows as T[]
}

export async function get<T = Record<string, unknown>>(db: DB, sql: string, params: Params = {}): Promise<T | undefined> {
  return (await all<T>(db, sql, params))[0]
}

export async function run(db: DB, sql: string, params: Params = {}): Promise<{ changes: number; lastInsertRowid: number }> {
  const [res] = await executor(db).query({ sql: named(sql) }, params)
  const header = res as ResultSetHeader
  return { changes: header.affectedRows, lastInsertRowid: Number(header.insertId) }
}

/** Nombre del bloqueo global de escritura (ver `tx`). */
const WRITE_LOCK = 'gestor_citas_write'
const WRITE_LOCK_TIMEOUT_S = 15

/**
 * Ejecuta `fn` en una transacción con **bloqueo global de escritura**.
 *
 * Los escritores se serializan con un bloqueo nombrado (`GET_LOCK`) que se toma ANTES de abrir la
 * transacción y se libera DESPUÉS de confirmarla. Así la comprobación de disponibilidad y la
 * inserción de una cita son atómicas aunque lleguen dos reservas a la vez, incluso desde procesos
 * o servidores distintos que compartan la base de datos. Los cambios de una transacción son
 * visibles para la siguiente en cuanto se libera el bloqueo.
 *
 * Las llamadas anidadas se unen a la transacción activa. Dentro de `fn`, todas las consultas hechas
 * con `get`/`all`/`run` usan automáticamente la conexión de la transacción.
 */
export async function tx<T>(db: DB, fn: () => Promise<T>): Promise<T> {
  const active = txStore.getStore()
  if (active && active.pool === db.pool) return fn()

  const conn = await db.pool.getConnection()
  let locked = false
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [WRITE_LOCK, WRITE_LOCK_TIMEOUT_S])
    locked = (rows as { got: number | null }[])[0]?.got === 1
    if (!locked) throw new Error('No se pudo obtener el bloqueo de escritura (base de datos ocupada).')
    await conn.beginTransaction()
    try {
      const result = await txStore.run({ pool: db.pool, conn }, fn)
      await conn.commit()
      return result
    } catch (err) {
      await conn.rollback()
      throw err
    }
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [WRITE_LOCK]).catch(() => undefined)
    conn.release()
  }
}

// ---------------------------------------------------------------- migraciones

const MIGRATION_LOCK = 'gestor_citas_migrate'

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

async function appliedMigrations(db: DB): Promise<Set<string>> {
  const rows = await all<{ ok: number }>(
    db,
    "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'"
  )
  if (!rows.length) return new Set()
  return new Set((await all<{ name: string }>(db, 'SELECT name FROM schema_migrations')).map((r) => r.name))
}

/** Migraciones disponibles que aún no se han aplicado. */
export async function pendingMigrations(db: DB): Promise<string[]> {
  const applied = await appliedMigrations(db)
  return migrationFiles().filter((f) => !applied.has(f))
}

/**
 * Aplica las migraciones pendientes, en orden y una a una. Un bloqueo nombrado impide que dos procesos
 * migren a la vez. Los DDL de MySQL se confirman solos (no hay rollback): las migraciones deben ser
 * idempotentes (`IF NOT EXISTS`) para poder repetirse si se interrumpen.
 */
export async function migrate(db: DB): Promise<string[]> {
  const conn = await db.pool.getConnection()
  const ran: string[] = []
  try {
    const [lock] = await conn.query('SELECT GET_LOCK(?, 60) AS got', [MIGRATION_LOCK])
    if ((lock as { got: number | null }[])[0]?.got !== 1) throw new Error('No se pudo obtener el bloqueo de migraciones.')
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(190) NOT NULL,
        applied_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
        PRIMARY KEY (name)
      ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4`)
      const [done] = await conn.query('SELECT name FROM schema_migrations')
      const applied = new Set((done as { name: string }[]).map((r) => r.name))
      for (const file of migrationFiles()) {
        if (applied.has(file)) continue
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
        // Una sentencia por llamada (sin multipleStatements, que ampliaría el riesgo de inyección).
        for (const statement of splitStatements(sql)) {
          try {
            await conn.query(statement)
          } catch (err) {
            throw new Error(`Migración ${file} fallida: ${(err as Error).message}`)
          }
        }
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file])
        ran.push(file)
      }
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]).catch(() => undefined)
    }
  } finally {
    conn.release()
  }
  return ran
}

/** Divide un fichero .sql en sentencias (por `;` fuera de comillas y comentarios). */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    const next = sql[i + 1]
    if (quote) {
      current += ch
      if (ch === '\\') current += sql[++i] ?? ''
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      current += '\n'
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === ';') {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}
