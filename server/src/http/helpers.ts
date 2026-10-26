import type { Context } from 'hono'
import type { ZodType, z } from 'zod'
import { type AuthVars } from '../modules/auth/auth.policy.ts'
import { clientIp } from './request.ts'
import type { Actor } from '../shared/audit.ts'
import { badRequest } from '../shared/errors.ts'

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('El cuerpo de la petición no es un JSON válido.')
  }
}

/** Lee y valida el cuerpo JSON con un esquema Zod (los errores se traducen a 400 con detalle por campo). */
export async function body<T extends ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return schema.parse(await readJson(c))
}

export function staffActor(c: Context<AuthVars>): Actor {
  return { label: c.get('user').email, ip: clientIp(c) }
}

export function intParam(c: Context, name: string): number {
  const n = Number(c.req.param(name))
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Identificador no válido.')
  return n
}

export function intQuery(c: Context, name: string, fallback: number, min = 1, max = 1000): number {
  const raw = c.req.query(name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n)) throw badRequest(`Parámetro ${name} no válido.`)
  return Math.min(max, Math.max(min, n))
}
