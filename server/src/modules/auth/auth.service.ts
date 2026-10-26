import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { get, run, type DB } from '../../shared/db.ts'
import { isoNow } from '../../shared/time.ts'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export type Role = 'admin' | 'staff'
export type SessionUser = { id: number; email: string; name: string; role: Role }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

// Los tokens de sesión solo se guardan hasheados: un volcado de la BD no permite suplantar sesiones.
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export async function createSession(db: DB, userId: number, ttlHours: number): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString()
  await run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($h, $u, $e, $ts)', {
    h: sha256(token),
    u: userId,
    e: expiresAt,
    ts: isoNow(),
  })
  // Limpieza oportunista de sesiones caducadas.
  await run(db, 'DELETE FROM sessions WHERE expires_at < $now', { now: isoNow() })
  return { token, expiresAt }
}

export async function destroySession(db: DB, token: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE token_hash = $h', { h: sha256(token) })
}

export async function destroyUserSessions(db: DB, userId: number, exceptToken?: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE user_id = $u AND token_hash != $keep', {
    u: userId,
    keep: exceptToken ? sha256(exceptToken) : '',
  })
}

export async function userForToken(db: DB, token: string): Promise<SessionUser | null> {
  const row = await get<SessionUser & { active: number }>(
    db,
    `SELECT u.id, u.email, u.name, u.role, u.active FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $h AND s.expires_at > $now`,
    { h: sha256(token), now: isoNow() }
  )
  if (!row || !row.active) return null
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}
