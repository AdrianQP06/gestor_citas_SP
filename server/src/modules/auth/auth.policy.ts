/**
 * Políticas de autorización: quién puede hacer qué.
 *  - admin: todo (configuración, equipo, WhatsApp, registro de actividad).
 *  - staff: gestión diaria (citas, clientes, bloqueos, reintento de recordatorios) y lectura de la configuración.
 * Las rutas declaran el requisito con `requireAuth(db)` o `requireAuth(db, 'admin')`.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { DB } from '../../shared/db.ts'
import { forbidden, unauthorized } from '../../shared/errors.ts'
import { userForToken, type Role, type SessionUser } from './auth.service.ts'

export const SESSION_COOKIE = 'citas_session'

export type AuthVars = { Variables: { user: SessionUser } }

export function setSessionCookie(c: Context, token: string, ttlHours: number, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: ttlHours * 3600,
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function sessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE)
}

export function requireAuth(db: DB, role?: Role): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const token = sessionToken(c)
    const user = token ? await userForToken(db, token) : null
    if (!user) throw unauthorized()
    if (role === 'admin' && user.role !== 'admin') throw forbidden('Solo los administradores pueden hacer esto.')
    c.set('user', user)
    await next()
  }
}
