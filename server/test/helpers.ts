import { after } from 'node:test'
import { DateTime } from 'luxon'
import { createApp } from '../src/app.ts'
import { dbOptions } from '../src/config/database.ts'
import { loadConfig, type Config } from '../src/config/env.ts'
import {
  TestWhatsAppProvider,
  type ReminderMessage,
  type SendResult,
  type WhatsAppProvider,
} from '../src/integrations/whatsapp/whatsapp.provider.ts'
import { hashPassword } from '../src/modules/auth/auth.service.ts'
import { DEFAULT_SETTINGS, saveSettings, saveWeek } from '../src/modules/settings/settings.service.ts'
import { closeDb, migrate, openDb, run, type DB } from '../src/shared/db.ts'
import { configureLogger } from '../src/shared/logger.ts'
import { addDays, isoWeekday, todayLocal } from '../src/shared/time.ts'

configureLogger({ silent: true })

export const TZ = 'Europe/Madrid'

/**
 * Las pruebas usan una base de datos MySQL/MariaDB DEDICADA (TEST_DATABASE_URL) que se vacía antes de
 * cada prueba. Nunca apuntes TEST_DATABASE_URL a la base de datos real.
 */
/** TEST_DATABASE_URL, o DATABASE_URL (del .env) con el nombre de la base terminado en «_test». Sin credenciales en el código. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  const base = process.env.DATABASE_URL
  if (!base) {
    throw new Error('Define TEST_DATABASE_URL (o DATABASE_URL en .env) para ejecutar las pruebas contra una base de datos *_test.')
  }
  const url = new URL(base)
  url.pathname = `/${url.pathname.replace(/^\//, '').replace(/_test$/, '')}_test`
  return url.toString()
}
const TEST_DATABASE_URL = testDatabaseUrl()

if (!/_test(\?|$)/.test(TEST_DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL debe apuntar a una base de datos cuyo nombre termine en "_test".')
}

export function makeConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:5173', DATABASE_URL: TEST_DATABASE_URL, ...overrides })
}

export function openTestDb(): DB {
  return openDb(dbOptions(makeConfig()))
}

let shared: DB | null = null
let migrated = false
after(async () => {
  if (shared) await closeDb(shared)
})

const TABLES = [
  'notifications',
  'support_requests',
  'operation_events',
  'operations',
  'appointments',
  'customers',
  'notification_recipients',
  'blocks',
  'exceptions',
  'working_hours',
  'settings',
  'sessions',
  'audit_log',
  'users',
]

let passwordHash: string | null = null

/** Estado limpio: esquema migrado, tablas vacías y datos base (negocio, horario L-V y dos usuarios). */
export async function setup(opts: { provider?: WhatsAppProvider; configEnv?: Record<string, string> } = {}) {
  shared ??= openTestDb()
  const db = shared
  if (!migrated) {
    await migrate(db)
    migrated = true
  }
  for (const t of TABLES) await run(db, `DELETE FROM ${t}`)

  await saveSettings(db, { ...DEFAULT_SETTINGS, business_name: 'Negocio Test', timezone: TZ })
  const open = { enabled: true, open_time: '09:00', close_time: '18:00', break_start: '14:00', break_end: '15:00' }
  await saveWeek(
    db,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      weekday <= 5
        ? { weekday, ...open }
        : { weekday, enabled: false, open_time: '09:00', close_time: '18:00', break_start: null, break_end: null }
    )
  )
  passwordHash ??= await hashPassword('Admin1234!')
  await run(db, "INSERT INTO users (email, name, password_hash, role) VALUES ('admin@test.local', 'Admin', $h, 'admin')", {
    h: passwordHash,
  })
  await run(db, "INSERT INTO users (email, name, password_hash, role) VALUES ('staff@test.local', 'Staff', $h, 'staff')", {
    h: passwordHash,
  })
  const config = makeConfig(opts.configEnv)
  const provider = opts.provider ?? new TestWhatsAppProvider()
  const app = createApp({ db, config, provider })
  return { db, app, config, provider }
}

export type TestApp = Awaited<ReturnType<typeof setup>>

export async function login(t: TestApp, email = 'admin@test.local') {
  const res = await t.app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin1234!' }),
  })
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('login failed: ' + (await res.text()))
  return cookie
}

export function api(t: TestApp, cookie?: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await t.app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null } as { status: number; json: any }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
  }
}

/** Primer día laborable (L-V) a partir de hoy + `minDays`. */
export function futureWorkday(minDays = 3): string {
  let d = addDays(todayLocal(TZ), minDays)
  while (isoWeekday(d) > 5) d = addDays(d, 1)
  return d
}

export function client(n = 1) {
  return { fullName: `Cliente Número ${n}`, phone: '+34600111222', email: `cliente${n}@example.com`, reason: 'Revisión general' }
}

export class RecordingProvider implements WhatsAppProvider {
  readonly name = 'meta' as const
  configured = true
  sent: ReminderMessage[] = []
  failures: Error[] = []
  async send(msg: ReminderMessage): Promise<SendResult> {
    const failure = this.failures.shift()
    if (failure) throw failure
    this.sent.push(msg)
    return { provider: 'meta', messageId: `wamid.${this.sent.length}` }
  }
}

export const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: TZ })

export type { DB }
