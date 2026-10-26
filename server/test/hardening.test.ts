import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderOperationReceipt } from '../src/modules/operations/operations.receipt.ts'
import { getOperation } from '../src/modules/operations/operations.service.ts'
import { audit, SYSTEM_ACTOR } from '../src/shared/audit.ts'
import { all, get } from '../src/shared/db.ts'
import { api, client, futureWorkday, login, setup, type TestApp } from './helpers.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function book(t: TestApp, cookie: string, n: number, time = '10:00'): Promise<number> {
  const res = await api(t, cookie).post('/api/v1/appointments', { ...client(n), date: futureWorkday(3 + n), time })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json.appointment?.id ?? res.json.id
}
const op = (a: ReturnType<typeof api>, appointmentId: number, over: Record<string, unknown> = {}) =>
  a.post('/api/v1/operations', { appointmentId, type: 'deposit', product: 'daily', amount: '50.00', currency: 'USD', ...over })

async function receiptTexts(t: TestApp, id: number) {
  const { operation, events } = await getOperation(t.db, id)
  const texts: string[] = []
  await renderOperationReceipt(operation, events, { business: 'Negocio Test', timezone: 'Europe/Madrid', generatedAt: '2030-01-01T10:00:00.000Z', collectText: texts })
  return texts
}

// ---------------------------------------------------------------- recibo desde la cita

test('recibo desde la cita: varias operaciones, cada recibo es de SU operación (código, importe, estado)', async () => {
  const t = await setup()
  const admin = await login(t, 'admin@test.local')
  const A = api(t, admin)
  const appt = await book(t, admin, 1)
  const ids: number[] = []
  ids.push((await op(A, appt, { amount: '50.00', currency: 'USD' })).json.operation.id)
  ids.push((await op(A, appt, { type: 'refund', product: undefined, amount: '12.34', currency: 'EUR' })).json.operation.id)
  ids.push((await op(A, appt, { product: 'master_business', amount: '99.99', currency: 'USD' })).json.operation.id)
  assert.equal((await A.post(`/api/v1/operations/${ids[1]}/confirm`)).status, 200)
  assert.equal((await A.post(`/api/v1/operations/${ids[2]}/void`, { reason: 'Registro duplicado' })).status, 200)

  const list = (await A.get(`/api/v1/operations?appointmentId=${appt}`)).json.operations as { id: number; code: string; amountLabel: string; status: string }[]
  assert.equal(list.length, 3, 'la lista de la cita las trae todas para elegir')
  assert.equal(new Set(list.map((o) => o.code)).size, 3)

  const expected = [
    { amount: '50,00 USD', status: /PENDIENTE/ },
    { amount: '12,34 EUR', status: /CONFIRMADA/ },
    { amount: '99,99 USD', status: /ANULADA/ },
  ]
  for (const [i, id] of ids.entries()) {
    const view = list.find((o) => o.id === id)!
    const texts = await receiptTexts(t, id)
    assert.ok(texts.includes(view.code), `recibo ${i}: lleva su código`)
    assert.ok(texts.some((s) => s.includes(expected[i]!.amount)), `recibo ${i}: lleva su importe`)
    assert.ok(texts.some((s) => expected[i]!.status.test(s)), `recibo ${i}: refleja su estado vigente`)
    for (const other of list.filter((o) => o.id !== id)) assert.ok(!texts.includes(other.code), `recibo ${i}: no mezcla el código de otra operación`)
    // por la ruta rápida de la cita
    const res = await t.app.request(`/api/v1/operations/${id}/receipt?appointmentId=${appt}&download=1`, { headers: { cookie: admin } })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition')!, new RegExp(`recibo-${view.code}\\.pdf`))
  }
})

test('recibo desde la cita: la operación debe pertenecer a la cita indicada; sin sesión 401', async () => {
  const t = await setup()
  const admin = await login(t, 'admin@test.local')
  const staff = await login(t, 'staff@test.local')
  const A = api(t, admin)
  const a1 = await book(t, admin, 1)
  const a2 = await book(t, admin, 2)
  const o1 = (await op(A, a1)).json.operation.id
  const get = (cookie: string | undefined, path: string) => t.app.request(path, { headers: cookie ? { cookie } : {} })

  assert.equal((await get(undefined, `/api/v1/operations/${o1}/receipt?appointmentId=${a1}`)).status, 401)
  assert.equal((await get(staff, `/api/v1/operations/${o1}/receipt?appointmentId=${a1}`)).status, 200, 'el personal ve los recibos de las citas, igual que la agenda')
  assert.equal((await get(admin, `/api/v1/operations/${o1}/receipt?appointmentId=${a2}`)).status, 404, 'otra cita → 404')
  assert.equal((await get(admin, `/api/v1/operations/${o1}/receipt?appointmentId=abc`)).status, 404)
  assert.equal((await get(admin, `/api/v1/operations/999999/receipt?appointmentId=${a1}`)).status, 404)
  assert.equal((await get(admin, `/api/v1/operations/${o1}/receipt`)).status, 200, 'sin cita sigue funcionando (detalle de la operación)')
})

// ---------------------------------------------------------------- CSP acotada a los PDF

test('CSP: estricta en toda la aplicación; solo los PDF permiten iframe y visor del navegador', async () => {
  const t = await setup()
  const admin = await login(t, 'admin@test.local')
  const A = api(t, admin)
  const appt = await book(t, admin, 1)
  const o = (await op(A, appt)).json.operation.id
  const h = async (path: string, cookie?: string) => (await t.app.request(path, { headers: cookie ? { cookie } : {} })).headers

  for (const path of ['/api/v1/public/info', '/api/health', '/api/v1/health']) {
    const hd = await h(path)
    const csp = hd.get('content-security-policy')
    if (!csp) continue
    assert.match(csp, /frame-ancestors 'none'/, `${path}: sin iframes`)
    assert.match(csp, /object-src 'none'/, `${path}: sin plugins`)
    assert.equal(hd.get('x-frame-options'), 'DENY')
  }
  const json = await h('/api/v1/operations?appointmentId=' + appt, admin)
  assert.match(json.get('content-security-policy')!, /frame-ancestors 'none'/)
  assert.match(json.get('content-security-policy')!, /object-src 'none'/)

  for (const path of [`/api/v1/operations/${o}/receipt`, '/api/v1/reports/operational/pdf']) {
    const pdf = await h(path, admin)
    assert.equal(pdf.get('content-type'), 'application/pdf')
    assert.equal(pdf.get('content-security-policy'), "default-src 'none'; object-src 'self'; frame-ancestors 'self'", path)
    assert.equal(pdf.get('x-frame-options'), 'SAMEORIGIN')
    assert.equal(pdf.get('cache-control'), 'no-store')
  }
  // Un error en la ruta del PDF (sin sesión) NO relaja nada
  const denied = await h(`/api/v1/operations/${o}/receipt`)
  assert.match(denied.get('content-security-policy')!, /frame-ancestors 'none'/)
})

// ---------------------------------------------------------------- marcas de tiempo

test('marcas de tiempo: los registros nuevos llevan la hora real de su inserción (no un valor compartido)', async () => {
  const t = await setup()
  const t0 = Date.now()
  const stamps: string[] = []
  for (let i = 0; i < 5; i++) {
    await audit(t.db, SYSTEM_ACTOR, 'diag.timestamp', 'diag', i)
    await sleep(15)
  }
  const rows = await all<{ created_at: string }>(t.db, "SELECT created_at FROM audit_log WHERE action = 'diag.timestamp' ORDER BY id")
  for (const r of rows) stamps.push(r.created_at)
  assert.equal(new Set(stamps).size, 5, 'cada auditoría tiene su propia marca')
  assert.deepEqual([...stamps].sort(), stamps, 'crecientes')
  for (const s of stamps) assert.ok(Date.parse(s) >= t0 - 5 && Date.parse(s) <= Date.now() + 5)

  // Reservas, clientes y sesiones por la API real
  const cookie = await login(t, 'admin@test.local')
  const before = Date.now()
  const a1 = await book(t, cookie, 1, '10:00')
  await sleep(40)
  const a2 = await book(t, cookie, 2, '11:00')
  const appts = await all<{ id: number; created_at: string; updated_at: string }>(t.db, 'SELECT id, created_at, updated_at FROM appointments WHERE id IN ($a, $b) ORDER BY id'.replace('$a', String(a1)).replace('$b', String(a2)))
  assert.notEqual(appts[0]!.created_at, appts[1]!.created_at, 'dos citas creadas con 40 ms de diferencia no comparten marca')
  for (const r of appts) {
    assert.ok(Date.parse(r.created_at) >= before - 5 && Date.parse(r.created_at) <= Date.now() + 5)
    assert.equal(r.updated_at, r.created_at)
  }
  const cust = await all<{ created_at: string }>(t.db, 'SELECT created_at FROM customers ORDER BY id')
  assert.equal(cust.length, 2)
  assert.notEqual(cust[0]!.created_at, cust[1]!.created_at)
  const sess = await get<{ created_at: string }>(t.db, 'SELECT created_at FROM sessions ORDER BY created_at DESC LIMIT 1')
  assert.ok(Date.parse(sess!.created_at) >= t0 - 5 && Date.parse(sess!.created_at) <= Date.now() + 5)
})
