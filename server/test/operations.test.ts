import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderOperationReceipt } from '../src/modules/operations/operations.receipt.ts'
import { formatMoney, MoneyError, minorToDecimal, parseAmountToMinor } from '../src/modules/operations/operations.money.ts'
import { getOperation } from '../src/modules/operations/operations.service.ts'
import { renderReportPdf } from '../src/modules/reports/pdf/pdf.renderer.ts'
import { buildReport } from '../src/modules/reports/reports.service.ts'
import { all, get, run } from '../src/shared/db.ts'
import { api, client, futureWorkday, login, setup, type TestApp } from './helpers.ts'

// Ejemplo de la especificación, SOLO en la BD de pruebas: depósito, Daily, 50.00 USD, sin referencia (método siempre Efectivo).
const EXAMPLE = { type: 'deposit', product: 'daily', amount: '50.00', currency: 'USD' }

async function book(t: TestApp, cookie: string, n = 1): Promise<number> {
  const date = futureWorkday(3 + n)
  const res = await api(t, cookie).post('/api/v1/appointments', {
    ...client(n),
    date,
    time: '10:00',
  })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json.appointment?.id ?? res.json.id
}

async function env() {
  const t = await setup()
  const admin = await login(t, 'admin@test.local')
  const staff = await login(t, 'staff@test.local')
  const appt = await book(t, admin)
  return { t, admin, staff, appt, A: api(t, admin), S: api(t, staff) }
}

const create = (a: ReturnType<typeof api>, appointmentId: number, over: Record<string, unknown> = {}) =>
  a.post('/api/v1/operations', { appointmentId, ...EXAMPLE, ...over })

// ---------------------------------------------------------------- dinero

test('importes: se convierten a unidades menores enteras sin errores de coma flotante', () => {
  assert.equal(parseAmountToMinor('50.00'), 5000)
  assert.equal(parseAmountToMinor('50,5'), 5050)
  assert.equal(parseAmountToMinor('0.10') + parseAmountToMinor('0.20'), 30)
  assert.equal(parseAmountToMinor('19.99'), 1999)
  assert.equal(minorToDecimal(5), '0.05')
  assert.equal(minorToDecimal(123456), '1234.56')
  assert.equal(formatMoney(5000, 'USD'), '50,00 USD')
  for (const bad of ['0', '0.00', '-5', '1.234', 'abc', '', '12345678', '1e3', ' ', '5.', '.5'])
    assert.throws(() => parseAmountToMinor(bad), MoneyError, `«${bad}» debe rechazarse`)
})

// ---------------------------------------------------------------- validaciones

test('crear: el ejemplo se guarda pendiente, con método Efectivo fijado por el servidor', async () => {
  const { A, appt, db } = await env().then((e) => ({ ...e, db: e.t.db }))
  const r = await create(A, appt)
  assert.equal(r.status, 201, JSON.stringify(r.json))
  const op = r.json.operation
  assert.match(op.code, /^SN-OP-[0-9A-Z]{8}$/)
  assert.equal(op.status, 'pending')
  assert.equal(op.amountMinor, 5000)
  assert.equal(op.currency, 'USD')
  assert.equal(op.method, 'cash')
  assert.equal(op.methodLabel, 'Efectivo')
  assert.equal(op.reference, null)
  assert.equal(r.json.events.length, 1)
  assert.equal(r.json.events[0].action, 'created')
  const row = await get<{ method: string; status: string }>(db, 'SELECT method, status FROM operations WHERE id = $i', { i: op.id })
  assert.deepEqual({ ...row }, { method: 'cash', status: 'pending' })
})

test('validaciones del backend: método, producto, importe, moneda, referencia y cita', async () => {
  const { A, appt } = await env()
  const bad = async (over: Record<string, unknown>, label: string) => {
    const r = await create(A, appt, over)
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.json)}`)
    return r
  }
  // El método solo puede ser Efectivo: cualquier otro valor se rechaza aunque el cliente lo envíe.
  for (const m of ['transfer', 'card', 'Transferencia', 'cash ', ''])
    await bad({ method: m }, `método ${m}`)
  assert.equal((await create(A, appt, { method: 'cash' })).status, 201)

  await bad({ product: undefined }, 'depósito sin producto')
  await bad({ product: 'gold' }, 'producto desconocido')
  await bad({ type: 'refund' }, 'reembolso con producto')
  await bad({ type: 'invalid' }, 'tipo inválido')
  for (const amount of ['0', '0.00', '-1', '1.005', 'abc', '99999999', 5000])
    if (amount !== 5000) await bad({ amount }, `importe ${amount}`)
  await bad({ currency: 'GBP' }, 'moneda no admitida')
  await bad({ currency: undefined }, 'moneda obligatoria')
  await bad({ reference: 'x'.repeat(61) }, 'referencia larga')
  await bad({ reference: 'a<script>' }, 'referencia con caracteres no permitidos')

  assert.equal((await create(A, appt, { type: 'refund', product: undefined, reference: 'DEV-001/2026' })).status, 201)
  assert.equal((await create(A, 999_999)).status, 404)
})

test('restricciones en la base de datos: importe positivo, método Efectivo y producto coherente', async () => {
  const { t, appt } = await env()
  const ins = (o: Record<string, unknown>) =>
    run(
      t.db,
      `INSERT INTO operations (code, appointment_id, type, product, amount_minor, currency, method, status, created_by, created_at, updated_at)
       VALUES ('SN-OP-TEST0001', $a, $type, $p, $m, 'USD', $method, 'pending', 1, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')`,
      { a: appt, type: 'deposit', p: 'daily', m: 100, method: 'cash', ...o }
    )
  await assert.rejects(ins({ m: 0 }))
  await assert.rejects(ins({ method: 'card' }))
  await assert.rejects(ins({ type: 'refund' })) // reembolso con producto
  await assert.rejects(ins({ p: null })) // depósito sin producto
})

// ---------------------------------------------------------------- permisos

test('permisos: sin sesión 401; personal registra pero no confirma; administrador confirma', async () => {
  const { t, S, A, appt } = await env()
  const anon = api(t)
  assert.equal((await anon.get(`/api/v1/operations?appointmentId=${appt}`)).status, 401)
  assert.equal((await anon.post('/api/v1/operations', { appointmentId: appt, ...EXAMPLE })).status, 401)
  assert.equal((await anon.get('/api/v1/operations/1/receipt')).status, 401)

  const created = await create(S, appt)
  assert.equal(created.status, 201)
  const id = created.json.operation.id

  const denied = await S.post(`/api/v1/operations/${id}/confirm`)
  assert.equal(denied.status, 403)
  assert.equal((await S.get(`/api/v1/operations/${id}`)).json.operation.status, 'pending')

  const ok = await A.post(`/api/v1/operations/${id}/confirm`)
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.operation.status, 'confirmed')
  assert.equal(ok.json.operation.confirmedBy.name, 'Admin')
})

test('anular: motivo obligatorio; pendiente solo creador o admin; confirmada solo admin', async () => {
  const { t, S, A, appt } = await env()
  // Segundo usuario de personal (reutiliza la contraseña de pruebas)
  await run(
    t.db,
    "INSERT INTO users (email, name, password_hash, role) SELECT 'staff2@test.local', 'Staff Dos', password_hash, 'staff' FROM users WHERE email = 'staff@test.local'"
  )
  const S2 = api(t, await login(t, 'staff2@test.local'))

  const p1 = (await create(S, appt)).json.operation.id
  assert.equal((await S.post(`/api/v1/operations/${p1}/void`, {})).status, 400, 'sin motivo')
  assert.equal((await S.post(`/api/v1/operations/${p1}/void`, { reason: 'ab' })).status, 400, 'motivo demasiado corto')
  assert.equal((await S2.post(`/api/v1/operations/${p1}/void`, { reason: 'No es mía' })).status, 403)
  const v = await S.post(`/api/v1/operations/${p1}/void`, { reason: 'Importe mal introducido' })
  assert.equal(v.status, 200, JSON.stringify(v.json))
  assert.equal(v.json.operation.status, 'voided')
  assert.equal(v.json.operation.voidReason, 'Importe mal introducido')
  assert.equal(v.json.operation.voidedBy.name, 'Staff')

  const p2 = (await create(S, appt)).json.operation.id
  assert.equal((await A.post(`/api/v1/operations/${p2}/confirm`)).status, 200)
  assert.equal((await S.post(`/api/v1/operations/${p2}/void`, { reason: 'Quiero anularla' })).status, 403)
  assert.equal((await A.post(`/api/v1/operations/${p2}/void`, { reason: 'Error de registro' })).status, 200)

  // Una operación pendiente de otro puede anularla un administrador
  const p3 = (await create(S, appt)).json.operation.id
  assert.equal((await A.post(`/api/v1/operations/${p3}/void`, { reason: 'Duplicada' })).status, 200)
})

// ---------------------------------------------------------------- transiciones e historial

test('transiciones: no se confirma dos veces, las anuladas son definitivas y no hay edición', async () => {
  const { t, A, appt } = await env()
  const id = (await create(A, appt)).json.operation.id
  assert.equal((await A.post(`/api/v1/operations/${id}/confirm`)).status, 200)
  assert.equal((await A.post(`/api/v1/operations/${id}/confirm`)).status, 409)
  assert.equal((await A.post(`/api/v1/operations/${id}/void`, { reason: 'Motivo válido' })).status, 200)
  assert.equal((await A.post(`/api/v1/operations/${id}/confirm`)).status, 409)
  assert.equal((await A.post(`/api/v1/operations/${id}/void`, { reason: 'Otra vez' })).status, 409)
  assert.equal((await A.post('/api/v1/operations/999999/confirm')).status, 404)
  // No existen rutas para modificar o borrar una operación
  assert.ok([404, 405].includes((await A.put(`/api/v1/operations/${id}`, { amount: '1.00' })).status))
  assert.ok([404, 405].includes((await A.del(`/api/v1/operations/${id}`)).status))
  const row = await get<{ amount_minor: string }>(t.db, 'SELECT amount_minor FROM operations WHERE id = $i', { i: id })
  assert.equal(Number(row!.amount_minor), 5000)
})

test('historial: cada cambio queda con estado anterior/nuevo, usuario y fecha; y se audita', async () => {
  const { t, S, A, appt } = await env()
  const id = (await create(S, appt)).json.operation.id
  await A.post(`/api/v1/operations/${id}/confirm`)
  await A.post(`/api/v1/operations/${id}/void`, { reason: 'Cliente desistió' })
  const { events, operation } = (await A.get(`/api/v1/operations/${id}`)).json
  assert.deepEqual(
    events.map((e: { action: string; fromStatus: string | null; toStatus: string; userName: string }) => [e.action, e.fromStatus, e.toStatus, e.userName]),
    [
      ['created', null, 'pending', 'Staff'],
      ['confirmed', 'pending', 'confirmed', 'Admin'],
      ['voided', 'confirmed', 'voided', 'Admin'],
    ]
  )
  assert.ok(events.every((e: { at: string }) => /^\d{4}-\d\d-\d\dT/.test(e.at)))
  assert.equal(events[2].note, 'Cliente desistió')
  assert.equal(operation.status, 'voided')

  const list = (await A.get(`/api/v1/operations?appointmentId=${appt}`)).json.operations
  assert.equal(list.length, 1, 'la anulada sigue en el historial de la cita')
  const acts = await all<{ action: string }>(t.db, "SELECT action FROM audit_log WHERE action LIKE 'operation.%' ORDER BY id")
  assert.deepEqual(acts.map((a) => a.action), ['operation.create', 'operation.confirm', 'operation.void'])
})

test('registrar operaciones no modifica la cita ni sus recordatorios', async () => {
  const { t, A, appt } = await env()
  const before = await get<Record<string, unknown>>(t.db, 'SELECT * FROM appointments WHERE id = $i', { i: appt })
  const notif = await get<{ n: number }>(t.db, 'SELECT COUNT(*) AS n FROM notifications')
  const id = (await create(A, appt)).json.operation.id
  await A.post(`/api/v1/operations/${id}/confirm`)
  const after = await get<Record<string, unknown>>(t.db, 'SELECT * FROM appointments WHERE id = $i', { i: appt })
  assert.deepEqual(after, before)
  assert.equal((await get<{ n: number }>(t.db, 'SELECT COUNT(*) AS n FROM notifications'))!.n, notif!.n)
})

// ---------------------------------------------------------------- recibo PDF

test('recibo PDF: válido, con código, «Método: Efectivo», importe y estado inequívoco', async () => {
  const { t, A, appt } = await env()
  const id = (await create(A, appt)).json.operation.id
  const render = async () => {
    const { operation, events } = await getOperation(t.db, id)
    const texts: string[] = []
    const pdf = await renderOperationReceipt(operation, events, {
      business: 'Negocio Test',
      timezone: 'Europe/Madrid',
      generatedAt: '2030-01-01T10:00:00.000Z',
      collectText: texts,
    })
    return { pdf, texts, operation }
  }

  let r = await render()
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(r.texts.includes(r.operation.code))
  assert.ok(r.texts.some((s) => s.includes('Método: Efectivo')))
  assert.ok(r.texts.some((s) => s.includes('50,00 USD')))
  assert.ok(r.texts.some((s) => /PENDIENTE/i.test(s)))
  assert.ok(!r.texts.some((s) => /CONFIRMADA/.test(s)), 'una pendiente no puede mostrarse como confirmada')

  await A.post(`/api/v1/operations/${id}/confirm`)
  r = await render()
  assert.ok(r.texts.some((s) => /CONFIRMADA/i.test(s)))
  assert.ok(!r.texts.some((s) => /PENDIENTE DE VERIFICACI/.test(s) && s === 'PENDIENTE'))

  await A.post(`/api/v1/operations/${id}/void`, { reason: 'Registro erróneo' })
  r = await render()
  assert.ok(r.texts.some((s) => /ANULADA/i.test(s)))
  assert.ok(r.texts.some((s) => s.includes('Registro erróneo')))
})

test('recibo PDF por la API: cabeceras, auditoría y 404', async () => {
  const { t, S, A, appt } = await env()
  const created = (await create(A, appt)).json.operation
  const cookie = await login(t, 'staff@test.local')
  const res = await t.app.request(`/api/v1/operations/${created.id}/receipt?download=1`, { headers: { cookie } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.match(res.headers.get('content-disposition')!, new RegExp(`attachment; filename="recibo-${created.code}.pdf"`))
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-')
  assert.equal((await S.get('/api/v1/operations/999999')).status, 404)
  const n = await get<{ n: number }>(t.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'operation.receipt'")
  assert.equal(n!.n, 1)
})

// ---------------------------------------------------------------- informes

const Q = { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }
type Tbl = { id: string; rows: Record<string, string | number>[] }
const tableOf = (rep: { tables: Tbl[] }, id: string) => rep.tables.find((x) => x.id === id)!

test('informe de operaciones: solo administradores', async () => {
  const { t, S, A } = await env()
  assert.equal((await S.get('/api/v1/reports/operations')).status, 403)
  assert.equal((await A.get('/api/v1/reports/operations?from=2026-01-01&to=2026-12-31')).status, 200)
  assert.ok(!(await S.get('/api/v1/reports/options')).json.types.some((x: { type: string }) => x.type === 'operations'))
  assert.ok((await api(t, await login(t)).get('/api/v1/reports/options')).json.types.some((x: { type: string }) => x.type === 'operations'))
})

test('informe de operaciones: totales por moneda/tipo/estado = SQL independiente, anuladas fuera de lo vigente', async () => {
  const { t, A, appt } = await env()
  const mk = async (amount: string, currency: string, type: 'deposit' | 'refund', fate: 'pending' | 'confirmed' | 'voided') => {
    const r = await create(A, appt, { amount, currency, type, product: type === 'deposit' ? 'master_business' : undefined })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    const id = r.json.operation.id
    if (fate !== 'pending') assert.equal((await A.post(`/api/v1/operations/${id}/confirm`)).status, 200)
    if (fate === 'voided') assert.equal((await A.post(`/api/v1/operations/${id}/void`, { reason: 'Prueba de anulación' })).status, 200)
  }
  await mk('50.00', 'USD', 'deposit', 'confirmed')
  await mk('0.10', 'USD', 'deposit', 'confirmed')
  await mk('0.20', 'USD', 'deposit', 'confirmed')
  await mk('25.50', 'USD', 'deposit', 'pending')
  await mk('999.00', 'USD', 'deposit', 'voided')
  await mk('10.00', 'USD', 'refund', 'confirmed')
  await mk('80.00', 'EUR', 'deposit', 'confirmed')
  await mk('5.05', 'EUR', 'refund', 'pending')
  await mk('7.00', 'EUR', 'refund', 'voided')

  const rep = await buildReport(t.db, 'operations', Q)
  const totals = tableOf(rep, 'totales').rows
  const sql = await all<{ currency: string; type: string; status: string; n: number; s: string }>(
    t.db,
    'SELECT currency, type, status, COUNT(*) AS n, SUM(amount_minor) AS s FROM operations GROUP BY currency, type, status'
  )
  const typeLbl = { deposit: 'Depósito', refund: 'Reembolso' } as const
  const stLbl = { pending: 'Pendiente de verificación', confirmed: 'Confirmada', voided: 'Anulada' } as const
  assert.equal(totals.length, sql.length)
  for (const g of sql) {
    const row = totals.find((x) => x.currency === g.currency && x.type === typeLbl[g.type as 'deposit'] && x.status === stLbl[g.status as 'pending'])
    assert.ok(row, `falta ${g.currency}/${g.type}/${g.status}`)
    assert.equal(row.count, Number(g.n))
    assert.equal(row.amount, formatMoney(Number(g.s), g.currency))
  }
  // Sin mezcla de monedas y sin duplicar
  assert.equal(totals.reduce((s, r) => s + Number(r.count), 0), 9)
  assert.equal(totals.find((x) => x.currency === 'USD' && x.type === 'Depósito' && x.status === 'Confirmada')!.amount, '50,30 USD')

  const kpi = (key: string) => rep.kpis.find((k) => k.key === key)!
  assert.equal(kpi('deposit_confirmed_USD').value, 50.3)
  assert.equal(kpi('deposit_pending_USD').value, 25.5)
  assert.equal(kpi('refund_confirmed_USD').value, 10)
  assert.equal(kpi('deposit_confirmed_EUR').value, 80)
  assert.equal(kpi('refund_pending_EUR').value, 5.05)
  assert.equal(kpi('refund_confirmed_EUR').value, 0)
  assert.equal(kpi('vigent_count').value, 7)
  assert.equal(kpi('voided_count').value, 2)

  // Totales vigentes: las anuladas (999,00 USD y 7,00 EUR) no cuentan
  const vig = tableOf(rep, 'vigentes').rows
  assert.deepEqual(vig.find((x) => x.currency === 'USD'), { currency: 'USD', deposits: '75,80 USD', refunds: '10,00 USD', count: 5 })
  assert.deepEqual(vig.find((x) => x.currency === 'EUR'), { currency: 'EUR', deposits: '80,00 EUR', refunds: '5,05 EUR', count: 2 })
  assert.equal(tableOf(rep, 'detalle').rows.length, 9)
  assert.ok(tableOf(rep, 'detalle').rows.every((r) => r.method === 'Efectivo'))

  // Filtro por estado
  const onlyVoided = await buildReport(t.db, 'operations', { ...Q, status: 'voided' })
  assert.equal(tableOf(onlyVoided, 'detalle').rows.length, 2)
  assert.equal(onlyVoided.kpis.find((k) => k.key === 'vigent_count')!.value, 0)
  const bad = await A.get('/api/v1/reports/operations?status=cancelled')
  assert.equal(bad.status, 400)

  // El PDF imprime los mismos totales
  const texts: string[] = []
  const pdf = await renderReportPdf(rep, { collectText: texts })
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(texts.some((s) => s.includes('50,30 USD')))
  assert.ok(texts.some((s) => s.includes('75,80 USD')))
  assert.ok(texts.some((s) => s.includes('Efectivo')))
})

test('informe de operaciones: periodo vacío y límites de fecha en la zona horaria del negocio', async () => {
  const { t, A, appt } = await env()
  const empty = await buildReport(t.db, 'operations', { from: '2020-01-01', to: '2020-01-31' })
  assert.equal(empty.empty, true)
  assert.equal(empty.kpis.find((k) => k.key === 'vigent_count')!.value, 0)
  assert.equal(tableOf(empty, 'totales').rows.length, 0)
  const texts: string[] = []
  await renderReportPdf(empty, { collectText: texts })
  assert.ok(texts.includes(empty.emptyMessage))

  const id = (await create(A, appt)).json.operation.id
  // Se fija la fecha de registro justo en el límite del día local (Europe/Madrid, CEST = UTC+2)
  await run(t.db, "UPDATE operations SET created_at = '2030-06-10T21:59:59.999Z' WHERE id = $i", { i: id })
  const inDay = await buildReport(t.db, 'operations', { from: '2030-06-10', to: '2030-06-10' })
  assert.equal(tableOf(inDay, 'detalle').rows.length, 1)
  await run(t.db, "UPDATE operations SET created_at = '2030-06-10T22:00:00.000Z' WHERE id = $i", { i: id })
  assert.equal(tableOf(await buildReport(t.db, 'operations', { from: '2030-06-10', to: '2030-06-10' }), 'detalle').rows.length, 0)
  assert.equal(tableOf(await buildReport(t.db, 'operations', { from: '2030-06-11', to: '2030-06-11' }), 'detalle').rows.length, 1)
})
