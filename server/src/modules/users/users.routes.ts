import { Hono } from 'hono'
import { z } from 'zod'
import { body, intParam, staffActor } from '../../http/helpers.ts'
import { audit } from '../../shared/audit.ts'
import { all, get, run, tx, type DB } from '../../shared/db.ts'
import { conflict, notFound } from '../../shared/errors.ts'
import { isoNow } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { passwordSchema } from '../auth/auth.schemas.ts'
import { destroyUserSessions, hashPassword, type Role } from '../auth/auth.service.ts'

const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Indica el nombre.').max(80),
  email: z.string().trim().toLowerCase().email('Correo electrónico no válido.'),
  password: passwordSchema,
  role: z.enum(['admin', 'staff']),
})

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['admin', 'staff']).optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
})

type UserRow = { id: number; email: string; name: string; role: Role; active: number; created_at: string }

/** Gestión del equipo (solo administradores). Montado en /api/v1/users. */
export function userRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db, 'admin'))

  const users = async () =>
    (await all<UserRow>(db, 'SELECT id, email, name, role, active, created_at FROM users ORDER BY name, id')).map(
      (u) => ({ ...u, active: !!u.active })
    )
  const otherActiveAdmins = async (excludeId: number) =>
    Number(
      (
        await get<{ n: number }>(
          db,
          "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != $id",
          { id: excludeId }
        )
      )!.n
    )

  app.get('/', async (c) => c.json({ users: await users() }))

  app.post('/', async (c) => {
    const input = await body(c, userCreateSchema)
    if (await get(db, 'SELECT id FROM users WHERE email = $e', { e: input.email }))
      throw conflict('email_in_use', 'Ya existe un usuario con ese correo electrónico.')
    const info = await run(db, 'INSERT INTO users (email, name, password_hash, role, created_at) VALUES ($e, $n, $h, $r, $ts)', {
      ts: isoNow(),
      e: input.email,
      n: input.name,
      h: await hashPassword(input.password),
      r: input.role,
    })
    await audit(db, staffActor(c), 'user.create', 'user', info.lastInsertRowid, { role: input.role })
    return c.json({ users: await users() }, 201)
  })

  app.patch('/:id', async (c) => {
    const id = intParam(c, 'id')
    const input = await body(c, userUpdateSchema)
    const passwordHash = input.password ? await hashPassword(input.password) : null
    // Dentro de la transacción con bloqueo para que dos cambios simultáneos no dejen al sistema sin administrador.
    await tx(db, async () => {
      const target = await get<UserRow>(db, 'SELECT * FROM users WHERE id = $id', { id })
      if (!target) throw notFound('El usuario no existe.')
      const willBeActiveAdmin = (input.role ?? target.role) === 'admin' && (input.active ?? !!target.active)
      if (target.role === 'admin' && target.active && !willBeActiveAdmin && (await otherActiveAdmins(id)) === 0)
        throw conflict('last_admin', 'Debe quedar al menos un administrador activo.')
      await run(db, 'UPDATE users SET name = $n, role = $r, active = $a WHERE id = $id', {
        id,
        n: input.name ?? target.name,
        r: input.role ?? target.role,
        a: (input.active ?? !!target.active) ? 1 : 0,
      })
      if (passwordHash) await run(db, 'UPDATE users SET password_hash = $h WHERE id = $id', { h: passwordHash, id })
      if (input.password || input.active === false) await destroyUserSessions(db, id)
    })
    await audit(db, staffActor(c), 'user.update', 'user', id, {
      role: input.role,
      active: input.active,
      passwordReset: !!input.password,
    })
    return c.json({ users: await users() })
  })

  return app
}
