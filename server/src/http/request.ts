import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

/** Limitador de ventana deslizante en memoria (suficiente para una instancia única). */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  max: number
  windowMs: number
  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }
  private prune(key: string, now: number) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }
  /** Registra un intento. Devuelve false si se ha superado el límite. */
  hit(key: string, now = Date.now()): boolean {
    const list = this.prune(key, now)
    if (list.length >= this.max) return false
    list.push(now)
    this.hits.set(key, list)
    return true
  }
  isLimited(key: string, now = Date.now()): boolean {
    return this.prune(key, now).length >= this.max
  }
  reset(key: string) {
    this.hits.delete(key)
  }
}

let trustProxy = false
export function setTrustProxy(value: boolean) {
  trustProxy = value
}

export function clientIp(c: Context): string {
  // Solo se confía en X-Forwarded-For si la app corre tras un proxy propio (TRUST_PROXY=true);
  // de lo contrario cualquiera podría falsearlo para esquivar los límites.
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (fwd) return fwd
  }
  try {
    return getConnInfo(c).remote.address ?? 'local'
  } catch {
    return 'local'
  }
}
