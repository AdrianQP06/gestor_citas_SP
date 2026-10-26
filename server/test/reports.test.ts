import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { createAppointment } from '../src/modules/appointments/appointments.service.ts'
import { renderReportPdf } from '../src/modules/reports/pdf/pdf.renderer.ts'
import {
  completionRate,
  cancellationRate,
  clientSplit,
  compare,
  reasonStats,
  timeline,
} from '../src/modules/reports/reports.metrics.ts'
import { buildReport, MAX_TABLE_ROWS } from '../src/modules/reports/reports.service.ts'
import type { ReportData } from '../src/modules/reports/reports.types.ts'
import { audit, SYSTEM_ACTOR } from '../src/shared/audit.ts'
import { all, get, run, type DB } from '../src/shared/db.ts'
import { localToUtcIso } from '../src/shared/time.ts'
import { TZ, api, client, futureWorkday, login, setup } from './helpers.ts'

// ---------------------------------------------------------------- utilidades de datos

let seq = 0
const utc = (date: string, time: string) => localToUtcIso(date, time, TZ)!

async function addCustomer(db: DB, n: number): Promise<number> {
  const email = `rep${n}@example.com`
  const found = await get<{ id: number }>(db, 'SELECT id FROM customers WHERE email = $e', { e: email })
  if (found) return found.id
  const r = await run(db, 'INSERT INTO customers (full_name, phone, email) VALUES ($n, $p, $e)', {
    n: `Cliente ${n}`,
    p: `+3460000${String(n).padStart(4, '0')}`,
    e: email,
  })
  return r.lastInsertRowid
}

type Appt = {
  cust?: number
  date: string
  time: string
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  reason?: string
  min?: number
  by?: 'client' | 'staff'
  why?: string
}

async function addAppt(db: DB, custId: number, o: Appt): Promise<number> {
  const start = DateTime.fromISO(utc(o.date, o.time), { zone: 'utc' })
  const r = await run(
    db,
    `INSERT INTO appointments (public_token, customer_id, starts_at, ends_at, reason, status, source, cancelled_by, cancel_reason)
     VALUES ($t, $c, $s, $e, $r, $st, 'staff', $by, $why)`,
    {
      t: `tok${++seq}`.padEnd(32, 'x'),
      c: custId,
      s: start.toISO()!,
      e: start.plus({ minutes: o.min ?? 30 }).toISO()!,
      r: o.reason ?? 'Revisión general',
      st: o.status ?? 'confirmed',
      by: o.status === 'cancelled' ? (o.by ?? 'client') : null,
      why: o.why ?? null,
    }
  )
  return r.lastInsertRowid
}

async function addReschedule(db: DB, apptId: number, from: [string, string], to: [string, string], actor = 'admin@test.local') {
  await audit(db, { label: actor }, 'appointment.reschedule', 'appointment', apptId, {
    from: { date: from[0], time: from[1] },
    to: { date: to[0], time: to[1] },
  })
}

const NOW = DateTime.fromISO('2030-06-20T12:00:00', { zone: TZ }).toUTC()
const kpi = (r: ReportData, key: string) => r.kpis.find((k) => k.key === key)!
const tableOf = (r: ReportData, id: string) => r.tables.find((t) => t.id === id)!

/** Datos de referencia (semana del 10 al 16 de junio de 2030, "ahora" = 20 de junio). */
async function baseData(db: DB) {
  const c1 = await addCustomer(db, 1)
  const c2 = await addCustomer(db, 2)
  const c3 = await addCustomer(db, 3)
  // Lunes 10
  const a1 = await addAppt(db, c1, { date: '2030-06-10', time: '09:00', status: 'completed', reason: 'Revisión' })
  await addAppt(db, c2, { date: '2030-06-10', time: '09:30', status: 'completed', reason: 'revisión  ' }) // mismo motivo, otra redacción
  await addAppt(db, c3, { date: '2030-06-10', time: '10:00', status: 'cancelled', by: 'client', reason: 'Primera consulta', why: 'Imprevisto' })
  await addAppt(db, c1, { date: '2030-06-10', time: '10:30', status: 'confirmed', reason: 'Seguimiento' }) // pasada sin cerrar
  // Martes 11
  const a5 = await addAppt(db, c2, { date: '2030-06-11', time: '09:00', status: 'completed', reason: 'Primera consulta' })
  await addAppt(db, c3, { date: '2030-06-11', time: '09:30', status: 'cancelled', by: 'staff', reason: 'Seguimiento' })
  // Sábado 15
  await addAppt(db, c1, { date: '2030-06-15', time: '10:00', status: 'pending', reason: 'Presupuesto' }) // pasada sin cerrar
  await addAppt(db, c2, { date: '2030-06-15', time: '11:00', status: 'completed', reason: 'Presupuesto' })
  // Período anterior (3-9 de junio): 2 citas completadas
  await addAppt(db, c1, { date: '2030-06-04', time: '09:00', status: 'completed' })
  await addAppt(db, c2, { date: '2030-06-05', time: '09:00', status: 'completed' })
  // Reprogramaciones: a1 movida 3 veces, a5 una vez
  await addReschedule(db, a1, ['2030-06-07', '09:00'], ['2030-06-08', '09:00'])
  await addReschedule(db, a1, ['2030-06-08', '09:00'], ['2030-06-09', '09:00'])
  await addReschedule(db, a1, ['2030-06-09', '09:00'], ['2030-06-10', '09:00'], 'cliente (portal)')
  await addReschedule(db, a5, ['2030-06-12', '09:00'], ['2030-06-11', '09:00'])
}

const Q = { from: '2030-06-10', to: '2030-06-16' }

// ---------------------------------------------------------------- fórmulas puras

test('porcentajes, comparaciones y variaciones', () => {
  assert.equal(compare(10, 5)?.deltaPct, 100)
  assert.equal(compare(5, 10)?.deltaPct, -50)
  assert.deepEqual(compare(7, 0), { previous: 0, delta: 7, deltaPct: null }, 'sin base de comparación')
  assert.deepEqual(compare(50, 40, true), { previous: 40, delta: 10, deltaPct: null }, 'los % se comparan en puntos')
  assert.equal(compare(null, 3), null)
})

test('citas completadas: sin canceladas en la fórmula; vencidas sin cerrar en el denominador; nunca se llama asistencia', () => {
  const now = '2030-06-20T00:00:00.000Z'
  const past = (status: 'completed' | 'cancelled' | 'pending' | 'confirmed') => ({ status, ends_at: '2030-06-10T10:00:00.000Z' })
  const future = (status: 'completed' | 'cancelled' | 'pending' | 'confirmed') => ({ status, ends_at: '2030-07-10T10:00:00.000Z' })

  const a = completionRate([past('completed'), past('completed'), past('completed'), past('cancelled'), past('confirmed')], now, [])
  assert.equal(a.value, 75, '3 / (3+1): la cancelada NO entra; la confirmada vencida sí (sin cerrar)')
  assert.equal(a.denominator, 4)
  assert.equal(a.unresolvedPast, 1)

  // Las cancelaciones no cambian el resultado, sean cuantas sean
  const manyCancelled = completionRate([past('completed'), past('completed'), ...Array.from({ length: 20 }, () => past('cancelled'))], now, [])
  assert.equal(manyCancelled.value, 100, 'solo completadas y sin cerrar cuentan: 2 / 2')
  assert.equal(completionRate([past('completed'), past('cancelled')], now, []).value, 100)

  const withFuture = completionRate([past('completed'), past('confirmed'), future('confirmed'), future('pending'), future('cancelled')], now, [])
  assert.equal(withFuture.value, 50, 'las citas futuras no entran en el denominador')

  const none = completionRate([past('confirmed'), past('pending')], now, [])
  assert.equal(none.value, null)
  assert.match(none.insufficient!, /sin cerrar/)
  const onlyCancelled = completionRate([past('cancelled'), past('cancelled')], now, [])
  assert.equal(onlyCancelled.value, null, 'solo canceladas: no hay base')

  const mostlyOpen = completionRate([past('completed'), past('confirmed'), past('confirmed'), past('pending')], now, [])
  assert.equal(mostlyOpen.value, null, 'más citas sin cerrar que cerradas → datos insuficientes')

  const filtered = completionRate([past('completed'), past('confirmed')], now, ['completed'])
  assert.equal(filtered.value, null, 'el filtro de estado que excluye pendientes/confirmadas impide calcularla')
  assert.equal(completionRate([], now, []).value, null)
})

test('tasa de cancelación: canceladas ÷ programadas; no se calcula con filtro de estado ni sin citas', () => {
  const rows = [{ status: 'cancelled' }, { status: 'confirmed' }, { status: 'completed' }, { status: 'pending' }] as const
  assert.equal(cancellationRate([...rows], []).value, 25)
  assert.equal(cancellationRate([...rows], ['pending', 'confirmed', 'cancelled', 'completed']).value, 25)
  assert.equal(cancellationRate([...rows], ['cancelled']).value, null)
  assert.match(cancellationRate([...rows], ['cancelled']).insufficient!, /filtro de estado/)
  assert.equal(cancellationRate([], []).value, null)
})

test('motivos: se agrupan ignorando mayúsculas y espacios', () => {
  const stats = reasonStats([
    { reason: 'Revisión', status: 'completed' },
    { reason: ' revisión  ', status: 'cancelled' },
    { reason: 'REVISIÓN', status: 'completed' },
    { reason: 'Otra', status: 'completed' },
  ])
  assert.equal(stats[0]!.count, 3)
  assert.equal(stats[0]!.completed, 2)
  assert.equal(stats[0]!.cancelled, 1)
  assert.equal(stats.length, 2)
})

test('clientes nuevos/recurrentes: solo con historial previo fiable', () => {
  const rows = [
    { customer_id: 1, status: 'completed' as const },
    { customer_id: 2, status: 'confirmed' as const },
    { customer_id: 3, status: 'cancelled' as const },
  ]
  const noHistory = clientSplit(rows, new Set(), '2030-06-12T00:00:00.000Z', '2030-06-10T00:00:00.000Z')
  assert.equal(noHistory.newCount, null)
  assert.match(noHistory.insufficient!, /no tiene citas anteriores/)

  const ok = clientSplit(rows, new Set([2]), '2030-01-01T00:00:00.000Z', '2030-06-10T00:00:00.000Z')
  assert.equal(ok.total, 2, 'las citas canceladas no cuentan como visita')
  assert.equal(ok.newCount, 1)
  assert.equal(ok.recurringCount, 1)
})

test('serie temporal: incluye intervalos vacíos y usa la zona horaria del negocio', () => {
  const rows = [
    { starts_at: '2030-06-10T07:00:00.000Z', status: 'completed' as const },
    { starts_at: '2030-06-10T08:00:00.000Z', status: 'cancelled' as const },
    // 22:30Z del día 12 = 00:30 del día 13 en Madrid (verano, UTC+2)
    { starts_at: '2030-06-12T22:30:00.000Z', status: 'confirmed' as const },
  ]
  const tl = timeline(rows, '2030-06-10', '2030-06-13', TZ, 'day')
  assert.deepEqual(tl.scheduled, [2, 0, 0, 1])
  assert.deepEqual(tl.completed, [1, 0, 0, 0])
  assert.deepEqual(tl.cancelled, [1, 0, 0, 0])
})

// ---------------------------------------------------------------- informe operativo con datos reales

test('operativo: los indicadores coinciden con los registros reales de la base de datos', async () => {
  const { db } = await setup()
  await baseData(db)
  const r = await buildReport(db, 'operational', Q, NOW)

  const sql = await all<{ status: string; n: number }>(
    db,
    'SELECT status, COUNT(*) AS n FROM appointments WHERE starts_at >= $s AND starts_at < $e GROUP BY status',
    { s: utc('2030-06-10', '00:00'), e: utc('2030-06-17', '00:00') }
  )
  const bySql = Object.fromEntries(sql.map((x) => [x.status, Number(x.n)]))
  const total = Object.values(bySql).reduce((a, b) => a + b, 0)

  assert.equal(total, 8)
  assert.equal(kpi(r, 'scheduled').value, total)
  assert.equal(kpi(r, 'completed').value, bySql.completed)
  assert.equal(kpi(r, 'cancelled').value, bySql.cancelled)
  assert.equal(kpi(r, 'pending').value, bySql.pending)
  assert.equal(kpi(r, 'upcoming').value, 0, 'todas las citas del período ya pasaron')

  // La tabla de estados suma exactamente el total
  const states = tableOf(r, 'estados')
  assert.equal(states.rows.reduce((s, row) => s + Number(row.count), 0), total)
  assert.equal(states.totals?.count, total)

  // Completadas = 4 / (4 + 2 vencidas sin cerrar); las 2 canceladas pasadas NO entran en la fórmula
  assert.equal(kpi(r, 'completion_rate').value, 66.7)
  assert.match(kpi(r, 'completion_rate').hint!, /4 de 6 vencidas no canceladas/)
  assert.ok(!r.kpis.some((k) => /asistencia/i.test(k.label)), 'ningún indicador se llama «asistencia»')
  assert.ok(r.notes.some((n) => /2 citas ya transcurridas siguen pendientes o confirmadas/.test(n)))
  // Cancelación = 2 / 8
  assert.equal(kpi(r, 'cancellation_rate').value, 25)

  // Comparación con el período anterior equivalente (3-9 de junio: 2 citas)
  assert.deepEqual(r.period.previous, { from: '2030-06-03', to: '2030-06-09' })
  assert.deepEqual(kpi(r, 'scheduled').comparison, { previous: 2, delta: 6, deltaPct: 300 })
  assert.deepEqual(kpi(r, 'cancelled').comparison, { previous: 0, delta: 2, deltaPct: null })

  // Gráficos coherentes con los totales
  const donut = r.charts.find((c) => c.id === 'estados')!
  assert.equal(donut.series[0]!.values.reduce((a, b) => a + b, 0), total)
  const evo = r.charts.find((c) => c.id === 'evolucion')!
  assert.equal(evo.series[0]!.values.reduce((a, b) => a + b, 0), total)
  assert.equal(evo.categories.length, 7)
  assert.deepEqual(r.charts.find((c) => c.id === 'dias')!.series[0]!.values, [4, 2, 0, 0, 0, 2, 0], 'lunes 4, martes 2, sábado 2')

  // Motivos agrupados («Revisión» y «revisión  » son el mismo)
  const reasons = tableOf(r, 'motivos')
  assert.equal(reasons.rows[0]!.count, 2)
  assert.equal(reasons.rows.reduce((s, x) => s + Number(x.count), 0), total)
})

test('reprogramadas: cada cita cuenta una sola vez aunque se haya movido varias veces', async () => {
  const { db } = await setup()
  await baseData(db)
  const r = await buildReport(db, 'operational', Q, NOW)
  assert.equal(kpi(r, 'rescheduled').value, 2, '4 cambios de horario sobre 2 citas')
  assert.equal(kpi(r, 'scheduled').value, 8, 'reprogramar no duplica atenciones')

  const c = await buildReport(db, 'cancellations', Q, NOW)
  const rep = tableOf(c, 'reprogramaciones')
  assert.equal(rep.totalRows, 2)
  assert.deepEqual(rep.rows.map((x) => x.changes).sort(), [1, 3])
  assert.equal(rep.totals?.changes, 4)
  const triple = rep.rows.find((x) => x.changes === 3)!
  assert.match(String(triple.last), /09\/06\/2030 09:00 → 10\/06\/2030 09:00/)
  assert.equal(triple.by, 'Cliente', 'el último cambio lo hizo el cliente desde el portal')
  assert.equal(kpi(c, 'rescheduled').value, 2)
  assert.match(kpi(c, 'rescheduled').hint!, /4 cambios/)
})

test('cancelaciones: quién cancela y totales', async () => {
  const { db } = await setup()
  await baseData(db)
  const c = await buildReport(db, 'cancellations', Q, NOW)
  assert.equal(kpi(c, 'cancelled').value, 2)
  assert.equal(kpi(c, 'by_client').value, 1)
  assert.equal(kpi(c, 'by_staff').value, 1)
  assert.equal(kpi(c, 'rate').value, 25)
  const t = tableOf(c, 'cancelaciones')
  assert.equal(t.totalRows, 2)
  assert.equal(t.rows.find((x) => x.by === 'Cliente')!.why, 'Imprevisto')
  assert.ok(!JSON.stringify(c).includes('@example.com'), 'sin correos en este informe')
})

// ---------------------------------------------------------------- filtros

test('los filtros de estado y motivo se aplican igual a indicadores, gráficos y tablas', async () => {
  const { db } = await setup()
  await baseData(db)

  const completed = await buildReport(db, 'operational', { ...Q, status: 'completed' }, NOW)
  assert.equal(kpi(completed, 'scheduled').value, 4)
  assert.equal(kpi(completed, 'completed').value, 4)
  assert.equal(kpi(completed, 'cancelled').value, 0)
  assert.equal(kpi(completed, 'cancellation_rate').value, null, 'con filtro de estado la tasa no es fiable')
  assert.equal(kpi(completed, 'completion_rate').value, null)
  assert.equal(tableOf(completed, 'estados').totals?.count, 4)
  assert.equal(completed.charts.find((c) => c.id === 'estados')!.series[0]!.values.reduce((a, b) => a + b, 0), 4)
  assert.deepEqual(completed.filters.statuses, ['completed'])
  assert.ok(completed.filterSummary.includes('Estados: Completada'))
  // el período anterior se compara con el mismo filtro
  assert.deepEqual(kpi(completed, 'scheduled').comparison, { previous: 2, delta: 2, deltaPct: 100 })

  const byReason = await buildReport(db, 'operational', { ...Q, reason: 'PRESUPUESTO' }, NOW) // sin distinguir mayúsculas
  assert.equal(kpi(byReason, 'scheduled').value, 2)
  assert.equal(kpi(byReason, 'cancellation_rate').value, 0, 'sin canceladas entre las citas de ese motivo')
  assert.equal(tableOf(byReason, 'motivos').rows.length, 1)
  assert.ok(byReason.filterSummary.includes('Motivo: contiene «PRESUPUESTO»'))

  const both = await buildReport(db, 'daily', { ...Q, status: 'cancelled,pending', reason: 'seguimiento' }, NOW)
  assert.equal(kpi(both, 'scheduled').value, 1, 'solo la cancelada de seguimiento (la confirmada no coincide con el estado)')
  assert.equal(tableOf(both, 'agenda').totalRows, 1)

  const all4 = await buildReport(db, 'operational', { ...Q, status: 'pending,confirmed,completed,cancelled' }, NOW)
  assert.deepEqual(all4.filters.statuses, [], 'seleccionar todos los estados equivale a no filtrar')
  assert.equal(kpi(all4, 'cancellation_rate').value, 25)
})

// ---------------------------------------------------------------- zona horaria

test('zona horaria: los límites del período y el día de cada cita son los del negocio', async () => {
  const { db } = await setup()
  const c = await addCustomer(db, 1)
  // Madrid en junio = UTC+2
  await addAppt(db, c, { date: '2030-06-14', time: '23:30', status: 'completed' }) // 21:30Z → día 14 (dentro)
  await addAppt(db, c, { date: '2030-06-15', time: '00:30', status: 'completed' }) // 22:30Z del 14 → día 15 local (fuera del día 14)
  await addAppt(db, c, { date: '2030-06-14', time: '00:00', status: 'completed' }) // 22:00Z del 13 → día 14 local (dentro)

  const day14 = await buildReport(db, 'daily', { from: '2030-06-14', to: '2030-06-14' }, NOW)
  assert.equal(kpi(day14, 'scheduled').value, 2)
  assert.deepEqual(tableOf(day14, 'agenda').rows.map((r) => r.time), ['00:00–00:30', '23:30–00:00'])
  const day15 = await buildReport(db, 'daily', { from: '2030-06-15', to: '2030-06-15' }, NOW)
  assert.equal(kpi(day15, 'scheduled').value, 1)
  assert.equal(tableOf(day15, 'agenda').rows[0]!.time, '00:30–01:00')
  assert.equal(day14.timezone, TZ)
  assert.ok(day14.filterSummary.includes(`Zona horaria: ${TZ}`))
})

// ---------------------------------------------------------------- períodos, límites y vacíos

test('límites de fechas y validaciones (400 con mensaje por campo)', async () => {
  const t = await setup()
  const a = api(t, await login(t))
  const get = (q: string) => a.get(`/api/v1/reports/operational?${q}`)

  assert.equal((await get('from=2030-06-10&to=2030-06-09')).status, 400)
  assert.match((await get('from=2030-06-10&to=2030-06-09')).json.error.fields.to, /anterior/)
  assert.equal((await get('from=2030-02-30&to=2030-03-02')).status, 400, 'fecha inexistente')
  assert.equal((await get('from=hoy&to=mañana')).status, 400)
  assert.equal((await get('from=2030-01-01&to=2031-01-02')).status, 400, '367 días')
  assert.match((await get('from=2030-01-01&to=2031-01-02')).json.error.message, /366/)
  assert.equal((await get('from=2030-01-01&to=2030-12-31')).status, 200, '365 días son válidos')
  assert.equal((await get('from=2030-01-01&to=2031-01-01')).status, 200, '366 días son válidos')
  assert.equal((await get('from=1999-01-01&to=1999-01-10')).status, 400, 'fuera de rango')
  assert.equal((await get('from=2030-06-01&to=2030-06-10&status=inventado')).status, 400)
  assert.equal((await a.get('/api/v1/reports/no-existe')).status, 404)
  assert.equal((await a.get('/api/v1/reports/no-existe/pdf')).status, 404)
  const bad = await a.get('/api/v1/reports/operational/pdf?from=2030-06-10&to=2030-06-09')
  assert.equal(bad.status, 400, 'el PDF valida igual que la pantalla')
})

test('períodos vacíos: mensajes claros, sin inventar cifras, y el PDF se genera', async () => {
  const { db } = await setup()
  for (const type of ['operational', 'daily', 'weekly', 'monthly', 'clients', 'cancellations', 'reasons', 'upcoming'] as const) {
    const r = await buildReport(db, type, { from: '2030-03-01', to: '2030-03-31' }, NOW)
    assert.equal(r.empty, true, type)
    assert.ok(r.emptyMessage.length > 10, type)
    assert.equal(r.charts.length, 0, `${type}: sin gráficos vacíos`)
    for (const k of r.kpis) {
      if (k.value !== null) assert.equal(k.value, 0, `${type}/${k.key} = 0`)
    }
    const pdf = await renderReportPdf(r)
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  }
  const op = await buildReport(db, 'operational', { from: '2030-03-01', to: '2030-03-31' }, NOW)
  assert.equal(kpi(op, 'completion_rate').value, null)
  assert.ok(kpi(op, 'completion_rate').insufficient)
  assert.equal(kpi(op, 'cancellation_rate').value, null)
  assert.equal(kpi(op, 'scheduled').comparison?.deltaPct, null)

  const texts: string[] = []
  await renderReportPdf(op, { collectText: texts })
  assert.ok(texts.includes('Sin resultados'))
  assert.ok(texts.includes(op.emptyMessage))
  assert.ok(texts.includes('Datos insuficientes'))
})

test('clientes nuevos y recurrentes: «Datos insuficientes» sin historial; con historial se cuentan sin duplicar', async () => {
  const { db } = await setup()
  const c1 = await addCustomer(db, 1)
  const c2 = await addCustomer(db, 2)
  const c3 = await addCustomer(db, 3)
  await addAppt(db, c1, { date: '2030-06-10', time: '09:00', status: 'completed' })
  await addAppt(db, c2, { date: '2030-06-10', time: '09:30', status: 'completed' })

  const noHistory = await buildReport(db, 'operational', Q, NOW)
  assert.equal(kpi(noHistory, 'new_clients').value, null)
  assert.ok(kpi(noHistory, 'new_clients').insufficient)

  // c1 ya vino en mayo (recurrente); c3 solo tenía una cita cancelada en mayo (no cuenta como visita)
  await addAppt(db, c1, { date: '2030-05-03', time: '09:00', status: 'completed' })
  await addAppt(db, c3, { date: '2030-05-04', time: '09:00', status: 'cancelled' })
  await addAppt(db, c3, { date: '2030-06-11', time: '09:00', status: 'completed' })
  await addAppt(db, c1, { date: '2030-06-12', time: '09:00', status: 'completed' }) // c1 repite en el período: sigue siendo 1 cliente
  const r = await buildReport(db, 'operational', Q, NOW)
  assert.equal(kpi(r, 'recurring_clients').value, 1)
  assert.equal(kpi(r, 'new_clients').value, 2)
  assert.match(kpi(r, 'new_clients').hint!, /de 3 clientes/)

  const cl = await buildReport(db, 'clients', Q, NOW)
  assert.equal(kpi(cl, 'clients').value, 3)
  const rows = tableOf(cl, 'clientes').rows
  assert.equal(rows.length, 3)
  assert.equal(rows.find((x) => x.name === 'Cliente 1')!.kind, 'Recurrente')
  assert.equal(rows.find((x) => x.name === 'Cliente 2')!.kind, 'Nuevo')
  assert.equal(rows.find((x) => x.name === 'Cliente 1')!.total, 2)
})

test('próximas citas: solo pendientes/confirmadas futuras', async () => {
  const { db } = await setup()
  const c = await addCustomer(db, 1)
  await addAppt(db, c, { date: '2030-06-25', time: '09:00', status: 'confirmed' })
  await addAppt(db, c, { date: '2030-06-25', time: '09:30', status: 'pending' })
  await addAppt(db, c, { date: '2030-06-26', time: '09:00', status: 'cancelled' })
  await addAppt(db, c, { date: '2030-06-26', time: '09:30', status: 'completed' })
  await addAppt(db, c, { date: '2030-06-15', time: '09:00', status: 'confirmed' }) // ya pasó (hoy es el 20)
  const r = await buildReport(db, 'upcoming', { from: '2030-06-10', to: '2030-07-10' }, NOW)
  assert.equal(kpi(r, 'upcoming').value, 2)
  assert.equal(kpi(r, 'pending').value, 1)
  assert.equal(kpi(r, 'confirmed').value, 1)
  assert.equal(tableOf(r, 'agenda').totalRows, 2)
  const onlyPending = await buildReport(db, 'upcoming', { from: '2030-06-10', to: '2030-07-10', status: 'pending' }, NOW)
  assert.equal(kpi(onlyPending, 'upcoming').value, 1)
  const cancelledOnly = await buildReport(db, 'upcoming', { from: '2030-06-10', to: '2030-07-10', status: 'cancelled' }, NOW)
  assert.equal(cancelledOnly.empty, true, 'las canceladas nunca son «próximas»')
})

test('informes diario, semanal y mensual: el resumen por día suma exactamente el detalle', async () => {
  const { db } = await setup()
  await baseData(db)
  for (const type of ['weekly', 'monthly'] as const) {
    const r = await buildReport(db, type, type === 'weekly' ? Q : { from: '2030-06-01', to: '2030-06-30' }, NOW)
    const summary = tableOf(r, 'por-dia')
    const detail = tableOf(r, 'agenda')
    assert.equal(summary.totals?.total, detail.totalRows, type)
    assert.equal(summary.rows.reduce((s, x) => s + Number(x.total), 0), detail.totalRows, type)
    for (const key of ['pending', 'confirmed', 'completed', 'cancelled'] as const) {
      assert.equal(summary.rows.reduce((s, x) => s + Number(x[key]), 0), summary.totals![key], `${type}/${key}`)
    }
    assert.equal(kpi(r, 'scheduled').value, detail.totalRows)
  }
  const d = await buildReport(db, 'daily', { from: '2030-06-10', to: '2030-06-10' }, NOW)
  assert.equal(tableOf(d, 'agenda').totalRows, 4)
  assert.equal(d.tables.find((t) => t.id === 'por-dia'), undefined, 'un solo día no necesita resumen por día')
  assert.equal(tableOf(d, 'agenda').rows[0]!.time, '09:00–09:30')
  assert.equal(tableOf(d, 'agenda').rows[0]!.phone, '+34600000001')
})

// ---------------------------------------------------------------- permisos y datos personales

test('permisos: sesión obligatoria; el informe de clientes solo para administradores; exportaciones auditadas', async () => {
  const t = await setup()
  const anon = api(t)
  const staff = api(t, await login(t, 'staff@test.local'))
  const admin = api(t, await login(t, 'admin@test.local'))
  const q = 'from=2030-06-10&to=2030-06-16'

  for (const path of ['operational', 'clients', 'operational/pdf', 'clients/pdf', 'options']) {
    assert.equal((await anon.get(`/api/v1/reports/${path}${path === 'options' ? '' : `?${q}`}`)).status, 401, path)
  }

  assert.equal((await staff.get(`/api/v1/reports/operational?${q}`)).status, 200)
  assert.equal((await staff.get(`/api/v1/reports/daily?${q}`)).status, 200)
  assert.equal((await staff.get(`/api/v1/reports/clients?${q}`)).status, 403)
  assert.equal((await staff.get(`/api/v1/reports/clients/pdf?${q}`)).status, 403)
  assert.equal((await admin.get(`/api/v1/reports/clients?${q}`)).status, 200)

  const opts = await staff.get('/api/v1/reports/options')
  assert.ok(!opts.json.types.some((x: { type: string }) => x.type === 'clients'), 'el personal no ve el informe de clientes')
  assert.ok((await admin.get('/api/v1/reports/options')).json.types.some((x: { type: string }) => x.type === 'clients'))

  const res = await t.app.request(`/api/v1/reports/operational/pdf?${q}&download=1`, {
    headers: { cookie: await login(t, 'staff@test.local') },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.match(res.headers.get('content-disposition')!, /^attachment; filename="supernova-operational-2030-06-10_2030-06-16\.pdf"$/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const inline = await t.app.request(`/api/v1/reports/operational/pdf?${q}`, { headers: { cookie: await login(t, 'staff@test.local') } })
  assert.match(inline.headers.get('content-disposition')!, /^inline;/)
  assert.match(inline.headers.get('content-security-policy')!, /frame-ancestors 'self'/)

  const logged = await all<{ actor: string; detail: string }>(t.db, "SELECT actor, detail FROM audit_log WHERE action = 'report.pdf' ORDER BY id")
  assert.equal(logged.length, 2)
  assert.equal(logged[0]!.actor, 'staff@test.local')
  assert.equal(JSON.parse(logged[0]!.detail).mode, 'download')
  assert.ok(!logged[0]!.detail.includes('Cliente'), 'la auditoría no guarda datos de clientes')
})

test('protección de datos: los informes no incluyen correos fuera del informe de clientes', async () => {
  const { db } = await setup()
  await baseData(db)
  for (const type of ['operational', 'daily', 'weekly', 'monthly', 'cancellations', 'reasons', 'upcoming'] as const) {
    const r = await buildReport(db, type, Q, NOW)
    assert.ok(!JSON.stringify(r).includes('@example.com'), `${type} sin correos`)
  }
  const clients = await buildReport(db, 'clients', Q, NOW)
  assert.ok(JSON.stringify(clients).includes('@example.com'))
})

// ---------------------------------------------------------------- PDF

async function bulk(db: DB, n: number, startDate = '2030-06-01') {
  const c = await addCustomer(db, 1)
  const base = DateTime.fromISO(utc(startDate, '08:00'), { zone: 'utc' })
  const statuses = ['completed', 'confirmed', 'pending', 'cancelled'] as const
  const chunk = 400
  for (let i = 0; i < n; i += chunk) {
    const params: Record<string, string | number> = {}
    const values: string[] = []
    for (let j = i; j < Math.min(n, i + chunk); j++) {
      const s = base.plus({ minutes: j * 30 })
      values.push(`($t${j}, ${c}, $s${j}, $e${j}, $r${j}, $st${j}, 'staff', $by${j})`)
      params[`t${j}`] = `bulk${j}`.padEnd(32, 'x')
      params[`s${j}`] = s.toISO()!
      params[`e${j}`] = s.plus({ minutes: 30 }).toISO()!
      params[`r${j}`] = ['Revisión general', 'Primera consulta', 'Seguimiento'][j % 3]!
      params[`st${j}`] = statuses[j % 4]!
      params[`by${j}`] = statuses[j % 4] === 'cancelled' ? 'client' : ''
    }
    await run(
      db,
      `INSERT INTO appointments (public_token, customer_id, starts_at, ends_at, reason, status, source, cancelled_by) VALUES ${values.join(', ')}`,
      params
    )
  }
  await run(db, "UPDATE appointments SET cancelled_by = NULL WHERE cancelled_by = ''")
}

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length

test('PDF multipágina: cabeceras repetidas, totales, numeración y cifras idénticas a la pantalla', async () => {
  const { db } = await setup()
  await bulk(db, 480) // ≈ 10 días de citas cada 30 min
  const report = await buildReport(db, 'monthly', { from: '2030-06-01', to: '2030-06-30' }, NOW)
  assert.equal(kpi(report, 'scheduled').value, 480)

  const texts: string[] = []
  const pdf = await renderReportPdf(report, { collectText: texts })
  const pages = pageCount(pdf)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pages >= 8, `480 filas deberían ocupar muchas páginas (hay ${pages})`)

  // Numeración «Página i de N» en todas las páginas
  for (let i = 1; i <= pages; i++) assert.ok(texts.includes(`Página ${i} de ${pages}`), `falta la numeración de la página ${i}`)

  // Cabecera de la tabla de detalle repetida en cada página donde continúa
  const headerCount = texts.filter((s) => s === 'Cliente').length
  assert.ok(headerCount >= 6, `la cabecera del detalle debe repetirse (aparece ${headerCount} veces)`)
  assert.ok(texts.filter((s) => s === 'Detalle de citas (continuación)').length >= 5)

  // Título, período, fecha de generación y totales
  assert.ok(texts.includes('Informe mensual'))
  assert.ok(texts.some((s) => s.startsWith('Supernova · Gestor de citas · Generado el 20/06/2030')))
  assert.ok(texts.includes('01/06/2030 – 30/06/2030 (30 días)'))
  assert.ok(texts.includes('480 citas'), 'fila de totales del detalle')
  const summary = tableOf(report, 'por-dia')
  assert.equal(summary.totals?.total, 480)
  assert.ok(texts.includes('480'), 'total del resumen por día y KPI')
  // Cada KPI del informe aparece en el PDF con el mismo valor que en pantalla
  for (const k of report.kpis) {
    assert.ok(texts.includes(String(k.value)), `el PDF muestra ${k.label} = ${k.value}`)
  }
  // Logotipo oficial incrustado y metadatos
  const raw = pdf.toString('latin1')
  assert.match(raw, /\/Subtype \/Image/)
  assert.match(raw, /Supernova/)
})

test('PDF operativo: filtros, comparaciones y gráficos presentes', async () => {
  const { db } = await setup()
  await baseData(db)
  const report = await buildReport(db, 'operational', { ...Q, reason: 'revisión' }, NOW)
  const texts: string[] = []
  const pdf = await renderReportPdf(report, { collectText: texts })
  assert.ok(pageCount(pdf) >= 1)
  for (const line of report.filterSummary) {
    const [k, ...rest] = line.split(': ')
    assert.ok(texts.includes(`${k}: `) && texts.includes(rest.join(': ')), `filtro impreso: ${line}`)
  }
  for (const c of report.charts) assert.ok(texts.includes(c.title), `gráfico «${c.title}»`)
  assert.ok(texts.some((s) => /vs\. anterior/.test(s)), 'comparación con el período anterior')
  assert.equal(texts.includes('Datos insuficientes'), report.kpis.some((k) => k.value === null), 'solo se imprime «Datos insuficientes» cuando falta un indicador')
  for (const note of report.notes) assert.ok(texts.includes(note), 'definiciones impresas')
})

test('tope de filas: se informa de las omitidas y los totales siguen siendo los reales', async () => {
  const { db } = await setup()
  const n = MAX_TABLE_ROWS + 120
  await bulk(db, n, '2030-03-01')
  const report = await buildReport(db, 'daily', { from: '2030-03-01', to: '2030-04-15' }, NOW)
  const detail = tableOf(report, 'agenda')
  assert.equal(detail.totalRows, n)
  assert.equal(detail.rows.length, MAX_TABLE_ROWS)
  assert.equal(detail.omittedRows, 120)
  assert.equal(kpi(report, 'scheduled').value, n, 'los indicadores usan todas las citas, no solo las mostradas')
  assert.equal(detail.totals?.client, `${n} citas`)
  const texts: string[] = []
  await renderReportPdf(report, { collectText: texts })
  assert.ok(texts.some((s) => s.includes(`de ${n.toLocaleString('es-ES')} filas`)))
})

// ---------------------------------------------------------------- no bloquea reservas

test('generar informes no impide reservar ni bloquea la escritura', async () => {
  const { db } = await setup()
  await bulk(db, 300)
  const date = futureWorkday()
  const [pdf, created] = await Promise.all([
    buildReport(db, 'monthly', { from: '2030-06-01', to: '2030-06-30' }, NOW).then((r) => renderReportPdf(r)),
    createAppointment(db, { date, time: '10:00', ...client(), internalNotes: '', status: 'confirmed' }, { audience: 'staff', actor: SYSTEM_ACTOR }),
  ])
  assert.ok(pdf.length > 1000)
  assert.equal(created.status, 'confirmed')
})
