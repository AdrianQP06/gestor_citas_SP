import { Hono } from 'hono'
import type { Config } from '../../config/env.ts'
import { body, staffActor } from '../../http/helpers.ts'
import { RateLimiter, clientIp } from '../../http/request.ts'
import { audit } from '../../shared/audit.ts'
import { get, run, type DB } from '../../shared/db.ts'
import { AppError, unauthorized } from '../../shared/errors.ts'
import { requireAuth, clearSessionCookie, sessionToken, setSessionCookie, type AuthVars } from './auth.policy.ts'
import { changePasswordSchema, loginSchema } from './auth.schemas.ts'
import {
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  userForToken,
  verifyPassword,
  type Role,
} from './auth.service.ts'

type UserRow = { id: number; email: string; name: string; role: Role; password_hash: string; active: number }

// Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe.
const DUMMY_HASH = await hashPassword('dummy-password-1')

export function authRoutes(db: DB, config: Config) {
  const app = new Hono<AuthVars>()
  // 8 intentos fallidos por IP+correo cada 15 minutos.
  const failures = new RateLimiter(8, 15 * 60_000)

  app.post('/login', async (c) => {
    const { email, password } = await body(c, loginSchema)
    const ip = clientIp(c)
    const key = `${ip}|${email}`
    if (failures.isLimited(key)) {
      throw new AppError(429, 'too_many_attempts', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
    }
    const user = await get<UserRow>(db, 'SELECT * FROM users WHERE email = $e', { e: email })
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !user.active || !ok) {
      failures.hit(key)
      await audit(db, { label: email, ip }, 'auth.login_failed', 'user', user?.id ?? null)
      throw new AppError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.')
    }
    failures.reset(key)
    const { token } = await createSession(db, user.id, config.SESSION_TTL_HOURS)
    setSessionCookie(c, token, config.SESSION_TTL_HOURS, config.cookieSecure)
    await audit(db, { label: user.email, ip }, 'auth.login', 'user', user.id)
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  })

  app.post('/logout', async (c) => {
    const token = sessionToken(c)
    if (token) {
      const user = await userForToken(db, token)
      await destroySession(db, token)
      if (user) await audit(db, { label: user.email, ip: clientIp(c) }, 'auth.logout', 'user', user.id)
    }
    clearSessionCookie(c)
    return c.json({ ok: true })
  })

  app.get('/me', async (c) => {
    const token = sessionToken(c)
    const user = token ? await userForToken(db, token) : null
    if (!user) throw unauthorized()
    return c.json({ user })
  })

  app.post('/password', requireAuth(db), async (c) => {
    const { currentPassword, newPassword } = await body(c, changePasswordSchema)
    const user = c.get('user')
    const row = (await get<UserRow>(db, 'SELECT * FROM users WHERE id = $id', { id: user.id }))!
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw new AppError(400, 'validation', 'La contraseña actual no es correcta.', {
        currentPassword: 'La contraseña actual no es correcta.',
      })
    }
    await run(db, 'UPDATE users SET password_hash = $h WHERE id = $id', { h: await hashPassword(newPassword), id: user.id })
    await destroyUserSessions(db, user.id, sessionToken(c))
    await audit(db, staffActor(c), 'auth.password_change', 'user', user.id)
    return c.json({ ok: true })
  })

  return app
}
