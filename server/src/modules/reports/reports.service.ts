import { DateTime } from 'luxon'
import type { z } from 'zod'
import type { DB } from '../../shared/db.ts'
import { localDateOf, localTimeOf, nowUtc } from '../../shared/time.ts'
import { formatMoney } from '../operations/operations.money.ts'
import { PRODUCT_LABEL, STATUS_LABEL_OP, TYPE_LABEL, type OperationStatus } from '../operations/operations.schemas.ts'
import { getSettings } from '../settings/settings.service.ts'
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  WEEKDAY_LABELS,
  completionRate,
  bucketKeys,
  cancellationRate,
  clientSplit,
  compare,
  countByStatus,
  demandByHour,
  demandByWeekday,
  granularityFor,
  pct,
  reasonStats,
  timeline,
} from './reports.metrics.ts'
import {
  customersWithPriorVisits,
  earliestVisitStart,
  loadAppointments,
  loadOperations,
  loadReschedules,
  type ApptRow,
  type RescheduleEvent,
} from './reports.queries.ts'
import { resolveFilters, type ResolvedFilters, type reportQuerySchema } from './reports.schemas.ts'
import {
  REPORT_TITLES,
  type ChartSpec,
  type Kpi,
  type ReportData,
  type ReportType,
  type TableSpec,
} from './reports.types.ts'

/** Máximo de filas por tabla en pantalla y PDF (el resto se indica como «filas omitidas»). */
export const MAX_TABLE_ROWS = 2000

const BRAND = '#040167'
const BRAND_SOFT = '#5a5acb'
const GOLD = '#96731a'
const GRAY = '#94a3b8'

const fmtDay = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const weekdayShort = (d: string) => capitalize(DateTime.fromISO(d, { zone: 'utc' }).setLocale('es').toFormat('ccc')).replace('.', '')
const timeRange = (r: Pick<ApptRow, 'starts_at' | 'ends_at'>, tz: string) =>
  `${localTimeOf(r.starts_at, tz)}–${localTimeOf(r.ends_at, tz)}`
const fmtPct = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')} %`)

type Ctx = {
  db: DB
  type: ReportType
  filters: ResolvedFilters
  tz: string
  business: string
  now: DateTime
  nowIso: string
}

function clip<T>(rows: T[]): { rows: T[]; omitted: number } {
  return rows.length > MAX_TABLE_ROWS
    ? { rows: rows.slice(0, MAX_TABLE_ROWS), omitted: rows.length - MAX_TABLE_ROWS }
    : { rows, omitted: 0 }
}

function table(
  spec: Omit<TableSpec, 'rows' | 'totalRows' | 'omittedRows'> & { rows: TableSpec['rows'] }
): TableSpec {
  const { rows, omitted } = clip(spec.rows)
  return { ...spec, rows, totalRows: spec.rows.length, ...(omitted ? { omittedRows: omitted } : {}) }
}

function statusLine(statuses: string[], operations = false): string {
  const label = (s: string) => (operations ? STATUS_LABEL_OP[s as OperationStatus] : STATUS_LABEL[s as keyof typeof STATUS_LABEL])
  return statuses.length ? statuses.map(label).join(', ') : 'Todos'
}

function agendaTable(rows: ApptRow[], tz: string, multiDay: boolean, title: string, id = 'agenda'): TableSpec {
  return table({
    id,
    title,
    columns: [
      ...(multiDay ? [{ key: 'date', label: 'Fecha', weight: 1.1 }] : []),
      { key: 'time', label: 'Horario', weight: 1.2 },
      { key: 'client', label: 'Cliente', weight: 2 },
      { key: 'phone', label: 'Teléfono', weight: 1.4 },
      { key: 'reason', label: 'Motivo', weight: 2.4 },
      { key: 'status', label: 'Estado', weight: 1.2 },
    ],
    rows: rows.map((r) => ({
      date: fmtDay(localDateOf(r.starts_at, tz)),
      time: timeRange(r, tz),
      client: r.full_name,
      phone: r.phone,
      reason: r.reason,
      status: STATUS_LABEL[r.status],
    })),
    totals: { [multiDay ? 'date' : 'time']: 'Total', client: `${rows.length} ${rows.length === 1 ? 'cita' : 'citas'}` },
    emptyMessage: 'No hay citas con estos filtros.',
  })
}

function daySummaryTable(rows: ApptRow[], f: ResolvedFilters, tz: string): TableSpec {
  const keys = bucketKeys(f.from, f.to, 'day')
  const byDay = new Map(keys.map((k) => [k, [] as ApptRow[]]))
  for (const r of rows) byDay.get(localDateOf(r.starts_at, tz))?.push(r)
  const lines = keys.map((k) => {
    const c = countByStatus(byDay.get(k)!)
    const total = byDay.get(k)!.length
    return { day: `${weekdayShort(k)} ${fmtDay(k).slice(0, 5)}`, total, pending: c.pending, confirmed: c.confirmed, completed: c.completed, cancelled: c.cancelled }
  })
  const sum = (key: 'total' | 'pending' | 'confirmed' | 'completed' | 'cancelled') => lines.reduce((s, l) => s + l[key], 0)
  return table({
    id: 'por-dia',
    title: 'Resumen por día',
    columns: [
      { key: 'day', label: 'Día', weight: 1.4 },
      { key: 'total', label: 'Programadas', align: 'right' },
      { key: 'pending', label: 'Pendientes', align: 'right' },
      { key: 'confirmed', label: 'Confirmadas', align: 'right' },
      { key: 'completed', label: 'Completadas', align: 'right' },
      { key: 'cancelled', label: 'Canceladas', align: 'right' },
    ],
    rows: lines,
    totals: { day: 'Total', total: sum('total'), pending: sum('pending'), confirmed: sum('confirmed'), completed: sum('completed'), cancelled: sum('cancelled') },
    emptyMessage: 'Sin citas en el período.',
  })
}

function statusKpis(rows: ApptRow[]): Kpi[] {
  const c = countByStatus(rows)
  return [
    { key: 'scheduled', label: 'Programadas', value: rows.length, format: 'count', hint: 'Todas las citas del período', tone: 'default' },
    { key: 'confirmed', label: 'Confirmadas', value: c.confirmed, format: 'count', tone: 'default' },
    { key: 'pending', label: 'Pendientes', value: c.pending, format: 'count', tone: 'warning' },
    { key: 'completed', label: 'Completadas', value: c.completed, format: 'count', tone: 'success' },
    { key: 'cancelled', label: 'Canceladas', value: c.cancelled, format: 'count', tone: 'danger' },
  ]
}

function statusDonut(rows: ApptRow[], title = 'Distribución por estado'): ChartSpec {
  const c = countByStatus(rows)
  return {
    id: 'estados',
    title,
    kind: 'donut',
    categories: STATUS_ORDER.map((s) => STATUS_LABEL[s]),
    series: [{ name: 'Citas', values: STATUS_ORDER.map((s) => c[s]) }],
    colors: STATUS_ORDER.map((s) => STATUS_COLOR[s]),
  }
}

const STATUS_NOTE =
  'Estados: Pendiente (reserva sin confirmar), Confirmada (aceptada por el negocio), Completada (el equipo la marcó como atendida) y Cancelada (anulada por el cliente o el equipo). «Programadas» = todas las citas cuya fecha cae en el período, sea cual sea su estado actual.'

// ------------------------------------------------------------------ informes

async function operational(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz, nowIso } = c
  const rows = await loadAppointments(db, f)
  const prevRows = f.previous
    ? await loadAppointments(db, { startUtc: f.previous.startUtc, endUtc: f.previous.endUtc, statuses: f.statuses, reason: f.reason })
    : []
  const counts = countByStatus(rows)
  const prevCounts = countByStatus(prevRows)

  const att = completionRate(rows, nowIso, f.statuses)
  const prevAtt = completionRate(prevRows, nowIso, f.statuses)
  const canc = cancellationRate(rows, f.statuses)
  const prevCanc = cancellationRate(prevRows, f.statuses)
  const upcoming = rows.filter((r) => (r.status === 'pending' || r.status === 'confirmed') && r.starts_at > nowIso).length

  const events = await loadReschedules(db, rows.map((r) => r.id))
  const rescheduledIds = new Set(events.map((e) => e.appointmentId))
  const rescheduled = rows.filter((r) => rescheduledIds.has(r.id)).length

  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const [prior, earliest] = await Promise.all([customersWithPriorVisits(db, customerIds, f.startUtc), earliestVisitStart(db)])
  const split = clientSplit(rows, prior, earliest, f.startUtc)

  const kpis: Kpi[] = [
    { key: 'scheduled', label: 'Citas programadas', value: rows.length, format: 'count', hint: 'Citas con fecha en el período', comparison: compare(rows.length, prevRows.length), tone: 'gold' },
    { key: 'completed', label: 'Completadas', value: counts.completed, format: 'count', hint: 'Marcadas como atendidas', comparison: compare(counts.completed, prevCounts.completed), tone: 'success' },
    {
      key: 'completion_rate',
      label: 'Citas completadas (vencidas, sin canceladas)',
      value: att.value,
      format: 'percent',
      hint: att.value === null ? undefined : `${att.completed} de ${att.denominator} vencidas no canceladas`,
      comparison: compare(att.value, prevAtt.value, true),
      ...(att.insufficient ? { insufficient: att.insufficient } : {}),
      tone: 'success',
    },
    { key: 'cancelled', label: 'Canceladas', value: counts.cancelled, format: 'count', comparison: compare(counts.cancelled, prevCounts.cancelled), tone: 'danger' },
    {
      key: 'cancellation_rate',
      label: 'Tasa de cancelación',
      value: canc.value,
      format: 'percent',
      hint: canc.value === null ? undefined : `${counts.cancelled} de ${rows.length} programadas`,
      comparison: compare(canc.value, prevCanc.value, true),
      ...(canc.insufficient ? { insufficient: canc.insufficient } : {}),
      tone: 'danger',
    },
    { key: 'pending', label: 'Pendientes', value: counts.pending, format: 'count', hint: 'Sin confirmar', comparison: compare(counts.pending, prevCounts.pending), tone: 'warning' },
    { key: 'upcoming', label: 'Próximas citas', value: upcoming, format: 'count', hint: 'Pendientes o confirmadas con fecha futura', tone: 'default' },
    {
      key: 'rescheduled',
      label: 'Reprogramadas',
      value: rescheduled,
      format: 'count',
      hint: rows.length ? `${fmtPct(pct(rescheduled, rows.length))} de las programadas · cada cita cuenta una vez` : undefined,
      tone: 'default',
    },
    {
      key: 'new_clients',
      label: 'Clientes nuevos',
      value: split.newCount,
      format: 'count',
      hint: split.newCount === null ? undefined : `de ${split.total} clientes atendidos o con cita`,
      ...(split.insufficient ? { insufficient: split.insufficient } : {}),
    },
    {
      key: 'recurring_clients',
      label: 'Clientes recurrentes',
      value: split.recurringCount,
      format: 'count',
      hint: split.recurringCount === null ? undefined : 'Con citas anteriores al período',
      ...(split.insufficient ? { insufficient: split.insufficient } : {}),
    },
  ]

  const g = granularityFor(f.days)
  const tl = timeline(rows, f.from, f.to, tz, g)
  const hours = demandByHour(rows, tz)
  const topReasons = reasonStats(rows)
  const charts: ChartSpec[] = rows.length
    ? [
        {
          id: 'evolucion',
          title: `Evolución de las citas (por ${g === 'day' ? 'día' : g === 'week' ? 'semana' : 'mes'})`,
          kind: 'line',
          categories: tl.labels,
          series: [
            { name: 'Programadas', values: tl.scheduled, color: BRAND },
            { name: 'Completadas', values: tl.completed, color: STATUS_COLOR.completed },
            { name: 'Canceladas', values: tl.cancelled, color: STATUS_COLOR.cancelled },
          ],
          ...(g === 'week' ? { note: 'Cada punto es la semana que empieza en la fecha indicada (dd/mm).' } : {}),
        },
        statusDonut(rows),
        ...(f.previous
          ? [
              {
                id: 'comparacion',
                title: 'Comparación con el período anterior',
                kind: 'groupedBar' as const,
                categories: ['Programadas', 'Completadas', 'Canceladas', 'Pendientes'],
                series: [
                  { name: `Actual (${fmtDay(f.from).slice(0, 5)}–${fmtDay(f.to).slice(0, 5)})`, values: [rows.length, counts.completed, counts.cancelled, counts.pending], color: BRAND },
                  { name: `Anterior (${fmtDay(f.previous.from).slice(0, 5)}–${fmtDay(f.previous.to).slice(0, 5)})`, values: [prevRows.length, prevCounts.completed, prevCounts.cancelled, prevCounts.pending], color: GRAY },
                ],
              },
            ]
          : []),
        { id: 'dias', title: 'Demanda por día de la semana', kind: 'bar', categories: WEEKDAY_LABELS, series: [{ name: 'Citas', values: demandByWeekday(rows, tz), color: BRAND }] },
        ...(hours.hours.length
          ? [{ id: 'horas', title: 'Demanda por franja horaria (hora de inicio)', kind: 'bar' as const, categories: hours.hours.map((h) => `${String(h).padStart(2, '0')}h`), series: [{ name: 'Citas', values: hours.counts, color: BRAND_SOFT }] }]
          : []),
        {
          id: 'motivos',
          title: 'Motivos de visita más frecuentes',
          kind: 'hbar',
          categories: topReasons.slice(0, 8).map((r) => r.label),
          series: [{ name: 'Citas', values: topReasons.slice(0, 8).map((r) => r.count), color: GOLD }],
        },
      ]
    : []

  const total = rows.length
  const tables: TableSpec[] = [
    table({
      id: 'estados',
      title: 'Resumen por estado',
      columns: [
        { key: 'status', label: 'Estado', weight: 2 },
        { key: 'count', label: 'Citas', align: 'right' },
        { key: 'share', label: '% del total', align: 'right' },
        { key: 'prev', label: 'Período anterior', align: 'right' },
      ],
      rows: STATUS_ORDER.map((s) => ({ status: STATUS_LABEL[s], count: counts[s], share: fmtPct(pct(counts[s], total)), prev: prevCounts[s] })),
      totals: { status: 'Total', count: total, share: total ? '100 %' : '—', prev: prevRows.length },
      emptyMessage: 'Sin citas.',
    }),
    table({
      id: 'motivos',
      title: 'Motivos de visita',
      columns: [
        { key: 'reason', label: 'Motivo', weight: 3 },
        { key: 'count', label: 'Citas', align: 'right' },
        { key: 'share', label: '% del total', align: 'right' },
      ],
      rows: topReasons.slice(0, 10).map((r) => ({ reason: r.label, count: r.count, share: fmtPct(pct(r.count, total)) })),
      emptyMessage: 'Sin motivos registrados.',
    }),
  ]

  const notes = [
    STATUS_NOTE,
    'Citas programadas = número de citas con fecha de inicio en el período (y que cumplen los filtros).',
    'Citas completadas = completadas ÷ (completadas + vencidas sin cerrar), solo con citas ya transcurridas y SIN contar las canceladas. No es una tasa de asistencia: el sistema no registra inasistencias («no se presentó»), por lo que la asistencia real no puede calcularse. Una cancelación nunca se interpreta como inasistencia. Si las vencidas sin cerrar superan a las completadas, el indicador muestra «Datos insuficientes».',
    'Tasa de cancelación = canceladas ÷ programadas del período (todos los estados). Con un filtro de estado activo no se calcula.',
    'Reprogramadas = citas del período con al menos un cambio de horario registrado en el registro de actividad. Una cita reprogramada varias veces cuenta una sola vez y nunca duplica la atención.',
    `Comparación: período anterior equivalente = ${f.previous ? `${fmtDay(f.previous.from)} – ${fmtDay(f.previous.to)}` : 'n/d'} (misma duración, termina el día anterior), con los mismos filtros. Variación % = (actual − anterior) ÷ anterior; en porcentajes se indica la diferencia en puntos (pp). Si el anterior es 0 no hay base de comparación.`,
    'Clientes nuevos = primera cita no cancelada del sistema dentro del período; recurrentes = con citas no canceladas anteriores. Solo se calculan si existen citas anteriores al período.',
    'Demanda por día/franja = citas programadas según su día de la semana y hora de inicio en la zona horaria del negocio. Los motivos son texto libre y se agrupan ignorando mayúsculas y espacios repetidos.',
  ]
  if (att.unresolvedPast > 0) {
    notes.push(`Aviso de calidad de datos: ${att.unresolvedPast} citas ya transcurridas siguen pendientes o confirmadas, sin resultado registrado.`)
  }
  return { kpis, charts, tables, notes, empty: total === 0, subtitle: 'Indicadores de eficiencia de la gestión de citas' }
}

async function agenda(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz, type } = c
  const rows = await loadAppointments(db, f)
  const multiDay = f.days > 1
  const g = granularityFor(f.days)
  const tl = timeline(rows, f.from, f.to, tz, g)
  const hours = demandByHour(rows, tz)
  const charts: ChartSpec[] = rows.length
    ? [
        type === 'daily' || f.days === 1
          ? { id: 'horas', title: 'Citas por hora de inicio', kind: 'bar', categories: hours.hours.map((h) => `${String(h).padStart(2, '0')}h`), series: [{ name: 'Citas', values: hours.counts, color: BRAND }] }
          : type === 'monthly'
            ? { id: 'dias', title: 'Evolución diaria', kind: 'line', categories: tl.labels, series: [{ name: 'Programadas', values: tl.scheduled, color: BRAND }, { name: 'Completadas', values: tl.completed, color: STATUS_COLOR.completed }, { name: 'Canceladas', values: tl.cancelled, color: STATUS_COLOR.cancelled }] }
            : { id: 'dias', title: 'Citas por día', kind: 'bar', categories: tl.labels, series: [{ name: 'Citas', values: tl.scheduled, color: BRAND }] },
        statusDonut(rows),
      ]
    : []
  const tables = [...(multiDay ? [daySummaryTable(rows, f, tz)] : []), agendaTable(rows, tz, multiDay, 'Detalle de citas')]
  return {
    kpis: statusKpis(rows),
    charts,
    tables,
    notes: [STATUS_NOTE, 'El detalle se ordena por fecha y hora de inicio (zona horaria del negocio). Los totales del resumen coinciden con el número de filas del detalle.'],
    empty: rows.length === 0,
    subtitle: type === 'daily' ? 'Agenda y estado de las citas del día' : type === 'weekly' ? 'Resumen y agenda de la semana' : 'Resumen y agenda del mes',
  }
}

async function upcoming(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz, nowIso } = c
  const active = (f.statuses.length ? f.statuses : (['pending', 'confirmed'] as const)).filter((s) => s === 'pending' || s === 'confirmed')
  const start = f.startUtc > nowIso ? f.startUtc : nowIso
  const rows = active.length ? (await loadAppointments(db, { startUtc: start, endUtc: f.endUtc, statuses: [...active], reason: f.reason })) : []
  const counts = countByStatus(rows)
  const tl = timeline(rows, f.from, f.to, tz, granularityFor(f.days))
  return {
    kpis: [
      { key: 'upcoming', label: 'Próximas citas', value: rows.length, format: 'count', tone: 'gold' },
      { key: 'pending', label: 'Por confirmar', value: counts.pending, format: 'count', tone: 'warning' },
      { key: 'confirmed', label: 'Confirmadas', value: counts.confirmed, format: 'count', tone: 'success' },
    ],
    charts: rows.length ? [{ id: 'dias', title: 'Próximas citas por día', kind: 'bar', categories: tl.labels, series: [{ name: 'Citas', values: tl.scheduled, color: BRAND }] }] : [],
    tables: [agendaTable(rows, tz, true, 'Agenda de próximas citas')],
    notes: ['Próximas citas = citas pendientes o confirmadas cuya hora de inicio es posterior al momento de generar el informe y cae en el período.', 'Las canceladas y completadas no se incluyen.'],
    empty: rows.length === 0,
    emptyMessage: 'No hay citas próximas pendientes o confirmadas en este período.',
    subtitle: 'Citas pendientes y confirmadas que aún no han ocurrido',
  }
}

async function clients(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz } = c
  const rows = await loadAppointments(db, f)
  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const [prior, earliest] = await Promise.all([customersWithPriorVisits(db, customerIds, f.startUtc), earliestVisitStart(db)])
  const split = clientSplit(rows, prior, earliest, f.startUtc)

  type Agg = { id: number; name: string; phone: string; email: string; total: number; completed: number; cancelled: number; active: number; last: string; visits: number }
  const byClient = new Map<number, Agg>()
  for (const r of rows) {
    const a = byClient.get(r.customer_id) ?? { id: r.customer_id, name: r.full_name, phone: r.phone, email: r.email, total: 0, completed: 0, cancelled: 0, active: 0, last: '', visits: 0 }
    a.total++
    if (r.status === 'completed') a.completed++
    if (r.status === 'cancelled') a.cancelled++
    if (r.status === 'pending' || r.status === 'confirmed') a.active++
    if (r.status !== 'cancelled') a.visits++
    if (r.starts_at > a.last) a.last = r.starts_at
    byClient.set(r.customer_id, a)
  }
  const list = [...byClient.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'))
  const kind = (a: Agg) => (a.visits === 0 || split.insufficient ? '—' : prior.has(a.id) ? 'Recurrente' : 'Nuevo')
  const sum = (k: 'total' | 'completed' | 'cancelled' | 'active') => list.reduce((s, a) => s + a[k], 0)

  return {
    kpis: [
      { key: 'clients', label: 'Clientes con citas', value: list.length, format: 'count', tone: 'gold' },
      { key: 'new', label: 'Nuevos', value: split.newCount, format: 'count', ...(split.insufficient ? { insufficient: split.insufficient } : {}), tone: 'success' },
      { key: 'recurring', label: 'Recurrentes', value: split.recurringCount, format: 'count', ...(split.insufficient ? { insufficient: split.insufficient } : {}) },
      { key: 'avg', label: 'Citas por cliente', value: list.length ? Math.round((rows.length / list.length) * 10) / 10 : null, format: 'count', hint: 'Promedio en el período' },
    ],
    charts: list.length
      ? [{ id: 'top', title: 'Clientes con más citas', kind: 'hbar', categories: list.slice(0, 8).map((a) => a.name), series: [{ name: 'Citas', values: list.slice(0, 8).map((a) => a.total), color: BRAND }] }]
      : [],
    tables: [
      table({
        id: 'clientes',
        title: 'Clientes del período',
        columns: [
          { key: 'name', label: 'Cliente', weight: 2.2 },
          { key: 'contact', label: 'Contacto', weight: 2.8 },
          { key: 'total', label: 'Citas', align: 'right', weight: 0.8 },
          { key: 'completed', label: 'Compl.', align: 'right', weight: 0.9 },
          { key: 'cancelled', label: 'Canc.', align: 'right', weight: 0.8 },
          { key: 'active', label: 'Activas', align: 'right', weight: 0.9 },
          { key: 'last', label: 'Última cita', weight: 1.2 },
          { key: 'kind', label: 'Tipo', weight: 1.2 },
        ],
        rows: list.map((a) => ({ name: a.name, contact: `${a.phone} · ${a.email}`, total: a.total, completed: a.completed, cancelled: a.cancelled, active: a.active, last: fmtDay(localDateOf(a.last, tz)), kind: kind(a) })),
        totals: { name: `${list.length} clientes`, total: sum('total'), completed: sum('completed'), cancelled: sum('cancelled'), active: sum('active') },
        emptyMessage: 'No hay clientes con citas en este período.',
      }),
    ],
    notes: [
      'Incluye datos personales (nombre, teléfono, correo): documento de uso interno, accesible solo para administradores.',
      'Citas = todas las citas del cliente en el período (cualquier estado). Activas = pendientes + confirmadas. Última cita = la de fecha más reciente en el período.',
      'Tipo: «Nuevo» si su primera cita no cancelada del sistema cae en el período; «Recurrente» si tiene citas no canceladas anteriores; «—» si no se puede distinguir (sin historial previo o solo citas canceladas).',
    ],
    empty: list.length === 0,
    subtitle: 'Actividad de los clientes en el período',
  }
}

async function cancellations(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz } = c
  const rows = await loadAppointments(db, f)
  const cancelled = rows.filter((r) => r.status === 'cancelled')
  const events = await loadReschedules(db, rows.map((r) => r.id))
  const byAppt = new Map<number, RescheduleEvent[]>()
  for (const e of events) byAppt.set(e.appointmentId, [...(byAppt.get(e.appointmentId) ?? []), e])
  const rescheduledRows = rows.filter((r) => byAppt.has(r.id))
  const rate = cancellationRate(rows, f.statuses)
  const byClient = cancelled.filter((r) => r.cancelled_by === 'client').length
  const byStaff = cancelled.filter((r) => r.cancelled_by === 'staff').length
  const unknown = cancelled.length - byClient - byStaff
  const tl = timeline(rows, f.from, f.to, tz, granularityFor(f.days))

  const fmtChange = (e: RescheduleEvent | undefined) =>
    e && e.fromDate && e.toDate ? `${fmtDay(e.fromDate)} ${e.fromTime ?? ''} → ${fmtDay(e.toDate)} ${e.toTime ?? ''}`.trim() : '—'
  const actorOf = (e: RescheduleEvent | undefined) => (!e ? '—' : e.actor.startsWith('cliente') ? 'Cliente' : 'Equipo')

  return {
    kpis: [
      { key: 'cancelled', label: 'Canceladas', value: cancelled.length, format: 'count', tone: 'danger' },
      { key: 'rate', label: 'Tasa de cancelación', value: rate.value, format: 'percent', hint: rate.value === null ? undefined : `${cancelled.length} de ${rows.length} programadas`, ...(rate.insufficient ? { insufficient: rate.insufficient } : {}), tone: 'danger' },
      { key: 'by_client', label: 'Canceladas por el cliente', value: byClient, format: 'count' },
      { key: 'by_staff', label: 'Canceladas por el equipo', value: byStaff, format: 'count' },
      { key: 'rescheduled', label: 'Citas reprogramadas', value: rescheduledRows.length, format: 'count', hint: `${events.filter((e) => rows.some((r) => r.id === e.appointmentId)).length} cambios de horario en total`, tone: 'gold' },
    ],
    charts: rows.length && (cancelled.length || rescheduledRows.length)
      ? [
          { id: 'evolucion', title: 'Cancelaciones en el tiempo', kind: 'bar', categories: tl.labels, series: [{ name: 'Canceladas', values: tl.cancelled, color: STATUS_COLOR.cancelled }] },
          { id: 'quien', title: 'Quién cancela', kind: 'donut', categories: ['Cliente', 'Equipo', 'Sin dato'], series: [{ name: 'Citas', values: [byClient, byStaff, unknown] }], colors: [BRAND, GOLD, GRAY] },
        ]
      : [],
    tables: [
      table({
        id: 'cancelaciones',
        title: 'Cancelaciones',
        columns: [
          { key: 'date', label: 'Fecha cita', weight: 1.1 },
          { key: 'time', label: 'Horario', weight: 1.2 },
          { key: 'client', label: 'Cliente', weight: 2 },
          { key: 'reason', label: 'Motivo de la cita', weight: 2 },
          { key: 'by', label: 'Cancelada por', weight: 1.2 },
          { key: 'why', label: 'Motivo de cancelación', weight: 2 },
        ],
        rows: cancelled.map((r) => ({ date: fmtDay(localDateOf(r.starts_at, tz)), time: timeRange(r, tz), client: r.full_name, reason: r.reason, by: r.cancelled_by === 'client' ? 'Cliente' : r.cancelled_by === 'staff' ? 'Equipo' : '—', why: r.cancel_reason || '—' })),
        totals: { date: 'Total', time: `${cancelled.length}` },
        emptyMessage: 'No hay cancelaciones en este período.',
      }),
      table({
        id: 'reprogramaciones',
        title: 'Reprogramaciones',
        columns: [
          { key: 'date', label: 'Fecha actual', weight: 1.1 },
          { key: 'time', label: 'Horario actual', weight: 1.2 },
          { key: 'client', label: 'Cliente', weight: 2 },
          { key: 'changes', label: 'Cambios', align: 'right', weight: 0.8 },
          { key: 'last', label: 'Último cambio', weight: 2.8 },
          { key: 'by', label: 'Por', weight: 1 },
          { key: 'status', label: 'Estado', weight: 1.2 },
        ],
        rows: rescheduledRows.map((r) => { const ev = byAppt.get(r.id)!; const last = ev[ev.length - 1]; return { date: fmtDay(localDateOf(r.starts_at, tz)), time: timeRange(r, tz), client: r.full_name, changes: ev.length, last: fmtChange(last), by: actorOf(last), status: STATUS_LABEL[r.status] } }),
        totals: { date: 'Total', time: `${rescheduledRows.length} citas`, changes: rescheduledRows.reduce((s, r) => s + byAppt.get(r.id)!.length, 0) },
        emptyMessage: 'No hay citas reprogramadas en este período.',
      }),
    ],
    notes: [
      STATUS_NOTE,
      'Una cita reprogramada se cuenta UNA sola vez aunque se haya movido varias veces (columna «Cambios»); no genera una atención adicional. Las reprogramaciones se obtienen del registro de actividad, que guarda cada cambio de horario.',
      'Tasa de cancelación = canceladas ÷ programadas del período. «Cancelada por» procede del estado guardado al cancelar (cliente por el portal, equipo desde el panel).',
    ],
    empty: rows.length === 0,
    subtitle: 'Citas canceladas y movidas de horario',
  }
}

async function reasons(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f } = c
  const rows = await loadAppointments(db, f)
  const stats = reasonStats(rows)
  const total = rows.length
  return {
    kpis: [
      { key: 'analyzed', label: 'Citas analizadas', value: total, format: 'count', tone: 'gold' },
      { key: 'distinct', label: 'Motivos distintos', value: stats.length, format: 'count' },
      { key: 'top_share', label: 'Peso del motivo principal', value: stats[0] ? pct(stats[0].count, total) : null, format: 'percent', hint: stats[0]?.label, ...(stats[0] ? {} : { insufficient: 'No hay citas en el período.' }) },
    ],
    charts: stats.length ? [{ id: 'motivos', title: 'Motivos más frecuentes', kind: 'hbar', categories: stats.slice(0, 10).map((s) => s.label), series: [{ name: 'Citas', values: stats.slice(0, 10).map((s) => s.count), color: GOLD }] }] : [],
    tables: [
      table({
        id: 'motivos',
        title: 'Motivos de visita',
        columns: [
          { key: 'reason', label: 'Motivo', weight: 3 },
          { key: 'count', label: 'Citas', align: 'right' },
          { key: 'share', label: '% del total', align: 'right' },
          { key: 'completed', label: 'Completadas', align: 'right' },
          { key: 'cancelled', label: 'Canceladas', align: 'right' },
        ],
        rows: stats.map((s) => ({ reason: s.label, count: s.count, share: fmtPct(pct(s.count, total)), completed: s.completed, cancelled: s.cancelled })),
        totals: { reason: 'Total', count: total, share: total ? '100 %' : '—', completed: stats.reduce((s, x) => s + x.completed, 0), cancelled: stats.reduce((s, x) => s + x.cancelled, 0) },
        emptyMessage: 'No hay motivos en este período.',
      }),
    ],
    notes: ['Los motivos son texto libre escrito por el cliente o el equipo; se agrupan ignorando mayúsculas y espacios repetidos, por lo que redacciones distintas del mismo motivo aparecerán separadas.', STATUS_NOTE],
    empty: total === 0,
    subtitle: 'Por qué acuden los clientes',
  }
}

/**
 * Informe de operaciones (depósitos y reembolsos registrados en las citas).
 * Reglas para no inducir a error:
 *  - Los importes se suman en unidades menores enteras y SIEMPRE por moneda: nunca se mezclan monedas.
 *  - «Vigentes» = pendientes de verificación + confirmadas. Las anuladas se muestran aparte y no entran en ningún total vigente.
 *  - Cada operación es una fila de la tabla `operations` (sin uniones que multipliquen filas): un importe no se cuenta dos veces.
 *  - Registrar un importe no prueba que el dinero se haya recibido o devuelto; «confirmada» = verificada por un administrador.
 */
async function operations(c: Ctx): Promise<Partial<ReportData>> {
  const { db, filters: f, tz } = c
  const rows = await loadOperations(db, { startUtc: f.startUtc, endUtc: f.endUtc, statuses: f.opStatuses })
  const minor = (r: { amount_minor: number | string }) => Number(r.amount_minor)

  type Group = { currency: string; type: 'deposit' | 'refund'; status: OperationStatus; count: number; minor: number }
  const groups = new Map<string, Group>()
  for (const r of rows) {
    const key = `${r.currency}|${r.type}|${r.status}`
    const g = groups.get(key) ?? { currency: r.currency, type: r.type, status: r.status, count: 0, minor: 0 }
    g.count++
    g.minor += minor(r)
    groups.set(key, g)
  }
  const currencies = [...new Set(rows.map((r) => r.currency))].sort()
  const group = (currency: string, type: Group['type'], status: OperationStatus) => groups.get(`${currency}|${type}|${status}`)
  const plural = (n: number) => `${n} ${n === 1 ? 'operación' : 'operaciones'}`

  const kpis: Kpi[] = []
  for (const cur of currencies) {
    const kpi = (key: string, label: string, type: Group['type'], status: OperationStatus, tone: Kpi['tone']): Kpi => {
      const g = group(cur, type, status)
      return { key: `${key}_${cur}`, label: `${label} (${cur})`, value: (g?.minor ?? 0) / 100, format: 'money', currency: cur, hint: plural(g?.count ?? 0), tone }
    }
    kpis.push(
      kpi('deposit_confirmed', 'Depósitos confirmados', 'deposit', 'confirmed', 'success'),
      kpi('deposit_pending', 'Depósitos pendientes de verificación', 'deposit', 'pending', 'warning'),
      kpi('refund_confirmed', 'Reembolsos confirmados', 'refund', 'confirmed', 'danger'),
      kpi('refund_pending', 'Reembolsos pendientes de verificación', 'refund', 'pending', 'warning')
    )
  }
  const vigent = rows.filter((r) => r.status !== 'voided').length
  const voided = rows.length - vigent
  kpis.push(
    { key: 'vigent_count', label: 'Operaciones vigentes', value: vigent, format: 'count', hint: 'Pendientes de verificación + confirmadas', tone: 'gold' },
    { key: 'voided_count', label: 'Operaciones anuladas', value: voided, format: 'count', hint: 'No cuentan en ningún total vigente' }
  )

  const STATUS_ORDER_OP: OperationStatus[] = ['confirmed', 'pending', 'voided']
  const totalsRows = currencies.flatMap((cur) =>
    (['deposit', 'refund'] as const).flatMap((type) =>
      STATUS_ORDER_OP.flatMap((status) => {
        const g = group(cur, type, status)
        return g
          ? [{ type: TYPE_LABEL[type], status: STATUS_LABEL_OP[status], currency: cur, count: g.count, amount: formatMoney(g.minor, cur), vigent: status === 'voided' ? 'No (anulada)' : 'Sí' }]
          : []
      })
    )
  )
  const vigentRows = currencies.map((cur) => {
    const sum = (type: Group['type']) => (['confirmed', 'pending'] as const).reduce((s, st) => s + (group(cur, type, st)?.minor ?? 0), 0)
    const cnt = (type: Group['type']) => (['confirmed', 'pending'] as const).reduce((s, st) => s + (group(cur, type, st)?.count ?? 0), 0)
    return { currency: cur, deposits: formatMoney(sum('deposit'), cur), refunds: formatMoney(sum('refund'), cur), count: cnt('deposit') + cnt('refund') }
  })

  const byStatus = (st: OperationStatus) => rows.filter((r) => r.status === st).length
  return {
    kpis,
    charts: rows.length
      ? [
          {
            id: 'estados',
            title: 'Operaciones por estado (número de operaciones)',
            kind: 'donut',
            categories: STATUS_ORDER_OP.map((s) => STATUS_LABEL_OP[s]),
            series: [{ name: 'Operaciones', values: STATUS_ORDER_OP.map(byStatus) }],
            colors: ['#059669', '#f59e0b', '#dc2626'],
          },
        ]
      : [],
    tables: [
      table({
        id: 'totales',
        title: 'Totales por tipo, estado y moneda',
        columns: [
          { key: 'type', label: 'Tipo', weight: 1.4 },
          { key: 'status', label: 'Estado', weight: 2 },
          { key: 'currency', label: 'Moneda', weight: 1 },
          { key: 'count', label: 'Operaciones', align: 'right', weight: 1.2 },
          { key: 'amount', label: 'Importe', align: 'right', weight: 1.8 },
          { key: 'vigent', label: '¿Vigente?', weight: 1.4 },
        ],
        rows: totalsRows,
        emptyMessage: 'No hay operaciones en este período.',
      }),
      table({
        id: 'vigentes',
        title: 'Total vigente por moneda (pendientes + confirmadas)',
        columns: [
          { key: 'currency', label: 'Moneda', weight: 1 },
          { key: 'deposits', label: 'Depósitos vigentes', align: 'right', weight: 2 },
          { key: 'refunds', label: 'Reembolsos vigentes', align: 'right', weight: 2 },
          { key: 'count', label: 'Operaciones', align: 'right', weight: 1.2 },
        ],
        rows: vigentRows,
        emptyMessage: 'No hay operaciones vigentes.',
      }),
      table({
        id: 'detalle',
        title: 'Detalle de operaciones',
        columns: [
          { key: 'code', label: 'Código', weight: 1.7 },
          { key: 'date', label: 'Fecha', weight: 1.3 },
          { key: 'type', label: 'Tipo', weight: 1.1 },
          { key: 'product', label: 'Producto', weight: 1.3 },
          { key: 'amount', label: 'Importe', align: 'right', weight: 1.4 },
          { key: 'method', label: 'Método', weight: 1 },
          { key: 'status', label: 'Estado', weight: 1.8 },
          { key: 'client', label: 'Cliente', weight: 1.7 },
          { key: 'by', label: 'Registró', weight: 1.4 },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          date: `${fmtDay(localDateOf(r.created_at, tz))} ${localTimeOf(r.created_at, tz)}`,
          type: TYPE_LABEL[r.type],
          product: r.product ? PRODUCT_LABEL[r.product] : '—',
          amount: formatMoney(minor(r), r.currency),
          method: 'Efectivo',
          status: STATUS_LABEL_OP[r.status],
          client: r.client_name,
          by: r.created_name,
        })),
        emptyMessage: 'No hay operaciones en este período.',
      }),
    ],
    notes: [
      'Este informe solo recoge operaciones REGISTRADAS en las citas. La aplicación no mueve dinero ni consulta pasarelas de pago: un importe registrado no significa que el dinero haya sido recibido o devuelto.',
      'Estados: «Pendiente de verificación» (registrada, sin verificar), «Confirmada» (verificada por un administrador) y «Anulada» (invalidada con motivo; se conserva el registro y su historial). El método es siempre Efectivo.',
      'Los importes se suman por moneda y por estado, sin convertir ni mezclar monedas. «Vigentes» = pendientes + confirmadas; las anuladas no se incluyen en ningún total vigente.',
      'Cada operación cuenta una sola vez. El período y los filtros se aplican a la fecha de registro de la operación; el filtro «Estado» es el de la operación (el de motivo no aplica a este informe).',
    ],
    empty: rows.length === 0,
    emptyMessage: 'No hay operaciones registradas en este período con los filtros aplicados.',
    subtitle: 'Depósitos y reembolsos registrados, por estado y moneda',
  }
}

const BUILDERS: Record<ReportType, (c: Ctx) => Promise<Partial<ReportData>>> = {
  operational,
  daily: agenda,
  weekly: agenda,
  monthly: agenda,
  clients,
  cancellations,
  reasons,
  upcoming,
  operations,
}

/** Construye un informe completo (datos reales + definiciones). Es la única fuente para pantalla y PDF. */
export async function buildReport(
  db: DB,
  type: ReportType,
  query: z.infer<typeof reportQuerySchema>,
  now: DateTime = nowUtc()
): Promise<ReportData> {
  const settings = await getSettings(db)
  const tz = settings.timezone
  const filters = resolveFilters(type, query, tz, now)
  const ctx: Ctx = { db, type, filters, tz, business: settings.business_name, now, nowIso: now.toISO()! }
  const part = await BUILDERS[type](ctx)

  const filterSummary = [
    `Período: ${fmtDay(filters.from)} – ${fmtDay(filters.to)} (${filters.days} ${filters.days === 1 ? 'día' : 'días'})`,
    `Estados: ${type === 'operations' ? statusLine(filters.opStatuses, true) : statusLine(filters.statuses)}`,
    `Motivo: ${type === 'operations' ? 'no aplica a este informe' : filters.reason ? `contiene «${filters.reason}»` : 'todos'}`,
    `Zona horaria: ${tz}`,
  ]
  return {
    type,
    title: REPORT_TITLES[type],
    subtitle: '',
    business: settings.business_name,
    timezone: tz,
    generatedAt: now.toISO()!,
    period: {
      from: filters.from,
      to: filters.to,
      days: filters.days,
      previous: filters.previous ? { from: filters.previous.from, to: filters.previous.to } : null,
    },
    filters: { from: filters.from, to: filters.to, statuses: type === 'operations' ? filters.opStatuses : filters.statuses, reason: filters.reason },
    filterSummary,
    empty: false,
    emptyMessage: 'No hay citas en este período con los filtros aplicados.',
    kpis: [],
    charts: [],
    tables: [],
    notes: [],
    ...part,
  }
}

