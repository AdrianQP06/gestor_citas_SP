/**
 * Copia de seguridad consistente de la base de datos con `mysqldump` (sin bloquear las escrituras).
 *   npm run backup -- [directorio]   (por defecto ./backups; conserva las últimas BACKUP_KEEP copias)
 * Requiere el cliente de MySQL en el PATH (`mysqldump`), o MYSQLDUMP_BIN con su ruta (XAMPP:
 * C:\xampp\mysql\bin\mysqldump.exe). La contraseña se pasa por MYSQL_PWD (no aparece en la lista de procesos).
 * Restaurar: `gunzip -c copia.sql.gz | mysql -u USUARIO -p BASE`  (ver docs/DEPLOYMENT.md).
 */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { loadConfig } from '../config/env.ts'

const config = loadConfig()
const url = new URL(config.DATABASE_URL)
const dir = resolve(process.argv[2] ?? process.env.BACKUP_DIR ?? './backups')
const keep = Number(process.env.BACKUP_KEEP ?? 14)
mkdirSync(dir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const target = join(dir, `citas-${stamp}.sql.gz`)
const database = url.pathname.replace(/^\//, '')

const args = [
  `--host=${url.hostname}`,
  `--port=${url.port || '3306'}`,
  `--user=${decodeURIComponent(url.username)}`,
  '--single-transaction', // instantánea consistente con InnoDB, sin bloquear
  '--routines',
  '--default-character-set=utf8mb4',
  ...(config.DATABASE_SSL ? ['--ssl-mode=VERIFY_CA', ...(config.DATABASE_SSL_CA ? [`--ssl-ca=${config.DATABASE_SSL_CA}`] : [])] : []),
  database,
]

const child = spawn(process.env.MYSQLDUMP_BIN ?? 'mysqldump', args, {
  env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', (d) => (stderr += String(d)))
const exited = new Promise<number>((res, rej) => {
  child.on('error', rej)
  child.on('close', (code) => res(code ?? 1))
})

try {
  await pipeline(child.stdout, createGzip(), createWriteStream(target))
  const code = await exited
  if (code !== 0) throw new Error(`mysqldump terminó con código ${code}: ${stderr.trim()}`)
} catch (err) {
  rmSync(target, { force: true })
  console.error(`No se pudo crear la copia: ${(err as Error).message}`)
  process.exit(1)
}
console.log(`Copia creada: ${target} (${Math.round(statSync(target).size / 1024)} KB)`)

const backups = readdirSync(dir)
  .filter((f) => /^citas-.*\.sql\.gz$/.test(f))
  .sort()
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
  rmSync(join(dir, old))
  console.log(`Eliminada copia antigua: ${old}`)
}
