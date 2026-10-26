import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get, run } from '../src/shared/db.ts'
import { loadConfig } from '../src/config/env.ts'
import { api, login, setup } from './helpers.ts'

test('login correcto: cookie HttpOnly + SameSite y sesión guardada solo como hash', async () => {
  const t = await setup()
  const res = await t.app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ADMIN@test.local', password: 'Admin1234!' }),
  })
  assert.equal(res.status, 200)
  const cookie = res.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  const token = cookie.split(';')[0]!.split('=')[1]!
  const stored = (await get<{ token_hash: string }>(t.db, 'SELECT token_hash FROM sessions'))!
  assert.notEqual(stored.token_hash, token)
  assert.equal(stored.token_hash.length, 64)
  const user = (await get<{ password_hash: string }>(t.db, "SELECT password_hash FROM users WHERE email = 'admin@test.local'"))!
  assert.ok(user.password_hash.startsWith('scrypt$') && !user.password_hash.includes('Admin1234'))
})

test('credenciales incorrectas: mensaje genérico y bloqueo tras 8 intentos', async () => {
  const t = await setup()
  const anon = api(t)
  const wrong = await anon.post('/api/v1/auth/login', { email: 'admin@test.local', password: 'mal' })
  const unknown = await anon.post('/api/v1/auth/login', { email: 'nadie@test.local', password: 'mal' })
  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, 401)
  assert.equal(wrong.json.error.message, unknown.json.error.message, 'no revela si el usuario existe')
  for (let i = 0; i < 7; i++) await anon.post('/api/v1/auth/login', { email: 'admin@test.local', password: 'mal' })
  const locked = await anon.post('/api/v1/auth/login', { email: 'admin@test.local', password: 'Admin1234!' })
  assert.equal(locked.status, 429, 'ni siquiera la contraseña correcta funciona durante el bloqueo')
})

test('los endpoints privados exigen sesión', async () => {
  const t = await setup()
  const anon = api(t)
  for (const path of ['/api/v1/dashboard', '/api/v1/appointments', '/api/v1/customers', '/api/v1/settings', '/api/v1/calendar?from=2030-01-01&to=2030-01-07', '/api/v1/notifications', '/api/v1/users', '/api/v1/audit']) {
    assert.equal((await anon.get(path)).status, 401, path)
  }
  assert.equal((await anon.post('/api/v1/appointments', {})).status, 401)
  assert.equal((await anon.get('/api/v1/auth/me')).status, 401)
  assert.equal((await anon.get('/api/v1/public/info')).status, 200, 'el portal es público')
  assert.equal((await anon.get('/api/v1/health')).status, 200)
})

test('permisos por rol: el personal no puede administrar', async () => {
  const t = await setup()
  const staff = api(t, await login(t, 'staff@test.local'))
  const admin = api(t, await login(t, 'admin@test.local'))

  assert.equal((await staff.get('/api/v1/settings')).status, 200)
  const current = (await staff.get('/api/v1/settings')).json.settings
  assert.equal((await staff.put('/api/v1/settings', current)).status, 403)
  assert.equal((await admin.put('/api/v1/settings', { ...current, buffer_min: 5 })).status, 200)

  assert.equal((await staff.get('/api/v1/users')).status, 403)
  assert.equal((await staff.get('/api/v1/audit')).status, 403)
  assert.equal((await staff.post('/api/v1/whatsapp/recipients', { name: 'Yo', phone: '+34600111222' })).status, 403)
  assert.equal((await staff.put('/api/v1/settings/week', [])).status, 403)
  assert.equal((await staff.put('/api/v1/settings/exceptions', { date: '2030-01-01', closed: true })).status, 403)
  assert.equal((await admin.get('/api/v1/users')).status, 200)

  // El personal sí puede crear bloqueos manuales
  const block = await staff.post('/api/v1/settings/blocks', { date: '2030-01-07', start_time: '10:00', end_time: '11:00', reason: 'Reunión' })
  assert.equal(block.status, 201)
})

test('gestión de usuarios: desactivar revoca sesiones y siempre queda un admin', async () => {
  const t = await setup()
  const adminCookie = await login(t, 'admin@test.local')
  const admin = api(t, adminCookie)
  const staffCookie = await login(t, 'staff@test.local')
  const staff = api(t, staffCookie)
  assert.equal((await staff.get('/api/v1/auth/me')).status, 200)

  const users = (await admin.get('/api/v1/users')).json.users as { id: number; email: string }[]
  const staffId = users.find((u) => u.email === 'staff@test.local')!.id
  const adminId = users.find((u) => u.email === 'admin@test.local')!.id

  assert.equal((await admin.patch(`/api/v1/users/${staffId}`, { active: false })).status, 200)
  assert.equal((await staff.get('/api/v1/auth/me')).status, 401, 'la sesión del usuario desactivado deja de valer')
  assert.equal((await api(t).post('/api/v1/auth/login', { email: 'staff@test.local', password: 'Admin1234!' })).status, 401)

  const lastAdmin = await admin.patch(`/api/v1/users/${adminId}`, { active: false })
  assert.equal(lastAdmin.status, 409)
  assert.equal(lastAdmin.json.error.code, 'last_admin')

  const weak = await admin.post('/api/v1/users', { name: 'Nuevo', email: 'nuevo@test.local', password: 'corta', role: 'staff' })
  assert.equal(weak.status, 400)
  assert.ok(weak.json.error.fields.password)
})

test('logout y cambio de contraseña invalidan sesiones', async () => {
  const t = await setup()
  const c1 = await login(t)
  const c2 = await login(t)
  const a1 = api(t, c1)
  const a2 = api(t, c2)

  const bad = await a1.post('/api/v1/auth/password', { currentPassword: 'incorrecta', newPassword: 'NuevaClave123' })
  assert.equal(bad.status, 400)
  assert.equal((await a1.post('/api/v1/auth/password', { currentPassword: 'Admin1234!', newPassword: 'NuevaClave123' })).status, 200)
  assert.equal((await a1.get('/api/v1/auth/me')).status, 200, 'la sesión actual se mantiene')
  assert.equal((await a2.get('/api/v1/auth/me')).status, 401, 'las demás sesiones se cierran')

  assert.equal((await a1.post('/api/v1/auth/logout')).status, 200)
  assert.equal((await a1.get('/api/v1/auth/me')).status, 401)
})

test('sesiones caducadas no son válidas', async () => {
  const t = await setup()
  const a = api(t, await login(t))
  await run(t.db, "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
  assert.equal((await a.get('/api/v1/auth/me')).status, 401)
})

test('protección CSRF: peticiones de escritura desde otro origen se rechazan', async () => {
  const t = await setup()
  const cookie = await login(t)
  const post = (origin?: string) =>
    t.app.request('/api/v1/settings/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...(origin ? { origin } : {}) },
      body: JSON.stringify({ date: '2030-01-07', start_time: '10:00', end_time: '11:00' }),
    })
  assert.equal((await post('https://evil.example')).status, 403)
  assert.equal((await post('http://localhost:5173')).status, 201, 'APP_URL es un origen permitido')
})

const DB = 'mysql://u:p@127.0.0.1:3306/x'

test('configuración de producción: exige HTTPS y cookie segura', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_URL: 'http://citas.example.com', DATABASE_URL: DB }), /https/)
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_URL: 'https://citas.example.com', COOKIE_SECURE: 'false', DATABASE_URL: DB }))
  const prod = loadConfig({ NODE_ENV: 'production', APP_URL: 'https://citas.example.com', DATABASE_URL: DB })
  assert.equal(prod.cookieSecure, true)
  assert.equal(prod.AUTO_MIGRATE, false)
  assert.equal(prod.HOST, '127.0.0.1')
})

test('errores internos no filtran detalles', async () => {
  const t = await setup()
  const res = await t.app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no-json' })
  assert.equal(res.status, 400)
  const notFound = await t.app.request('/api/v1/nada')
  assert.equal(notFound.status, 404)
})
