import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get, run } from '../src/shared/db.ts'
import { saveSettings } from '../src/modules/settings/settings.service.ts'
import { api, login, setup } from './helpers.ts'

const VALID = { fullName: 'Persona de Prueba', phone: '+34 600 111 222', reason: 'no_date', message: 'Necesito algo la semana próxima', consent: true }

async function env() {
  const t = await setup()
  const admin = api(t, await login(t, 'admin@test.local'))
  const staff = api(t, await login(t, 'staff@test.local'))
  return { t, A: admin, S: staff, P: api(t) }
}
const post = (p: ReturnType<typeof api>, over: Record<string, unknown> = {}) => p.post('/api/v1/public/support-requests', { ...VALID, ...over })

test('solicitud pública: se guarda pendiente, con consentimiento y fecha reales; el mensaje no promete contacto', async () => {
  const { t, P } = await env()
  const before = Date.now()
  const r = await post(P)
  assert.equal(r.status, 201, JSON.stringify(r.json))
  assert.deepEqual(r.json, { received: true }, 'la respuesta solo confirma la recepción')
  const row = await get<Record<string, string>>(t.db, 'SELECT * FROM support_requests')
  assert.equal(row!.status, 'pending')
  assert.equal(row!.reason, 'no_date')
  assert.equal(row!.phone_digits, '34600111222')
  assert.equal(row!.handled_by, null)
  for (const col of ['consent_at', 'created_at', 'updated_at']) {
    const ms = Date.parse(row![col]!)
    assert.ok(ms >= before - 5 && ms <= Date.now() + 5, `${col} es la hora real de la inserción`)
  }
  // Auditoría sin datos personales: solo el motivo
  const a = await get<{ actor: string; detail: string }>(t.db, "SELECT actor, detail FROM audit_log WHERE action = 'support.create'")
  assert.equal(a!.actor, 'cliente (portal)')
  assert.deepEqual(JSON.parse(a!.detail), { reason: 'no_date' })
  assert.ok(!/Persona|600/.test(a!.detail))
})

test('solicitud pública: validación en el servidor', async () => {
  // Cada intento cuenta para el límite por IP (también los inválidos), así que cada caso usa una aplicación nueva.
  const bad = async (over: Record<string, unknown>, label: string) => {
    const { t, P } = await env()
    const r = await post(P, over)
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.json)}`)
    assert.equal((await get<{ n: number }>(t.db, 'SELECT COUNT(*) n FROM support_requests'))!.n, 0, `${label}: no se guardó`)
  }
  await bad({ consent: false }, 'sin consentimiento')
  await bad({ consent: undefined }, 'consentimiento ausente')
  await bad({ phone: '12' }, 'teléfono corto')
  await bad({ phone: 'abc' }, 'teléfono con letras')
  await bad({ fullName: 'A' }, 'nombre corto')
  await bad({ reason: 'otra_cosa' }, 'motivo inválido')
  await bad({ message: 'x'.repeat(301) }, 'mensaje largo')
  await bad({ website: 'http://spam.example' }, 'campo trampa relleno')
  const { t, P } = await env()
  assert.equal((await post(P, { message: undefined, reason: 'urgent' })).status, 201, 'el mensaje es opcional')
  assert.equal((await get<{ n: number }>(t.db, 'SELECT COUNT(*) n FROM support_requests'))!.n, 1)
})

test('solicitud pública: no se duplica una pendiente del mismo número y se limita por IP', async () => {
  const { t, P } = await env()
  assert.equal((await post(P, { phone: '+34600111222' })).status, 201)
  assert.equal((await post(P, { phone: '+34 600-111-222', fullName: 'Otra Persona' })).status, 201, 'misma respuesta')
  assert.equal((await get<{ n: number }>(t.db, 'SELECT COUNT(*) n FROM support_requests'))!.n, 1, 'no se duplica')

  // Con otros números sí se crean; el límite por IP es de 5 intentos por hora (cuentan los ya hechos)
  for (let i = 0; i < 3; i++) assert.equal((await post(P, { phone: `+3460022200${i}` })).status, 201)
  const limited = await post(P, { phone: '+34600999000' })
  assert.equal(limited.status, 429)
})

test('solicitud pública: respeta el interruptor del portal', async () => {
  const { t, P } = await env()
  const { getSettings } = await import('../src/modules/settings/settings.service.ts')
  await saveSettings(t.db, { ...(await getSettings(t.db)), portal_enabled: false })
  assert.equal((await post(P)).status, 403)
})

test('bandeja interna: autenticación, listado y contador', async () => {
  const { A, S, P } = await env()
  assert.equal((await P.get('/api/v1/support-requests')).status, 401)
  assert.equal((await P.get('/api/v1/support-requests/summary')).status, 401)
  assert.equal((await P.post('/api/v1/support-requests/1/attend', {})).status, 401)
  await post(P, { phone: '+34600000001', reason: 'urgent' })
  await post(P, { phone: '+34600000002', reason: 'no_date' })
  const list = await S.get('/api/v1/support-requests')
  assert.equal(list.status, 200)
  assert.equal(list.json.pending, 2)
  assert.equal(list.json.requests.length, 2)
  assert.equal(list.json.requests[0].reasonLabel, 'Necesito atención urgente', 'la más antigua primero')
  assert.equal((await A.get('/api/v1/support-requests/summary')).json.pending, 2)
  assert.equal((await A.get('/api/v1/support-requests?status=attended')).json.requests.length, 0)
  assert.equal((await A.get('/api/v1/support-requests?status=raro')).status, 400)
})

test('gestión: atender y cerrar con trazabilidad; estados finales definitivos', async () => {
  const { t, A, S, P } = await env()
  await post(P, { phone: '+34600000001' })
  await post(P, { phone: '+34600000002' })
  const [first, second] = (await A.get('/api/v1/support-requests')).json.requests as { id: number }[]

  const ok = await S.post(`/api/v1/support-requests/${first!.id}/attend`, { note: 'Llamada realizada' })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.request.status, 'attended')
  assert.equal(ok.json.request.handledBy, 'Staff')
  assert.equal(ok.json.request.staffNote, 'Llamada realizada')
  assert.ok(ok.json.request.handledAt)

  assert.equal((await A.post(`/api/v1/support-requests/${first!.id}/attend`, {})).status, 409, 'no se atiende dos veces')
  assert.equal((await A.post(`/api/v1/support-requests/${first!.id}/close`, { note: 'Ya no hace falta' })).status, 409, 'no se cierra una atendida')

  assert.equal((await A.post(`/api/v1/support-requests/${second!.id}/close`, {})).status, 400, 'cerrar exige una nota')
  assert.equal((await A.post(`/api/v1/support-requests/${second!.id}/close`, { note: 'ab' })).status, 400)
  const closed = await A.post(`/api/v1/support-requests/${second!.id}/close`, { note: 'Número duplicado' })
  assert.equal(closed.json.request.status, 'closed')
  assert.equal(closed.json.request.handledBy, 'Admin')
  assert.equal((await A.post(`/api/v1/support-requests/${second!.id}/attend`, {})).status, 409)
  assert.equal((await A.post('/api/v1/support-requests/999999/attend', {})).status, 404)

  assert.equal((await A.get('/api/v1/support-requests/summary')).json.pending, 0)
  const acts = await all<{ action: string }>(t.db, "SELECT action FROM audit_log WHERE action LIKE 'support.%' ORDER BY id")
  assert.deepEqual(acts.map((x) => x.action), ['support.create', 'support.create', 'support.attend', 'support.close'])

  // Tras atender, una nueva solicitud del mismo número vuelve a crearse
  await post(P, { phone: '+34600000001' })
  assert.equal((await get<{ n: number }>(t.db, "SELECT COUNT(*) n FROM support_requests WHERE phone_digits = '34600000001'"))!.n, 2)
})

test('base de datos: una solicitud gestionada exige responsable y fecha', async () => {
  const { t } = await env()
  const ins = (status: string) =>
    run(
      t.db,
      `INSERT INTO support_requests (full_name, phone, phone_digits, reason, status, consent_at, created_at, updated_at)
       VALUES ('X Y', '+34600000009', '34600000009', 'other', $s, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')`,
      { s: status }
    )
  await assert.rejects(ins('attended'))
  await ins('pending')
})

test('la solicitud no toca citas, clientes ni recordatorios', async () => {
  const { t, P } = await env()
  const counts = async () =>
    (await get<Record<string, number>>(t.db, 'SELECT (SELECT COUNT(*) FROM appointments) a, (SELECT COUNT(*) FROM customers) c, (SELECT COUNT(*) FROM notifications) n'))!
  const before = await counts()
  await post(P)
  assert.deepEqual(await counts(), before)
})
