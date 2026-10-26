/**
 * Cálculos puros (sin base de datos) de los informes. Cada función documenta su fórmula; las mismas
 * definiciones se imprimen en la sección «Definiciones» de cada informe y están en docs/REPORTS.md.
 */
import { DateTime } from 'luxon'
import { addDays, isoWeekday, localDateOf, toLocal } from '../../shared/time.ts'
import type { ApptRow } from './reports.queries.ts'
import type { Comparison, ReportStatus } from './reports.types.ts'

export const STATUS_ORDER: ReportStatus[] = ['pending', 'confirmed', 'completed', 'cancelled']
export const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
}
/** Colores de estado (tonos Tailwind emerald/amber/red como el resto de la interfaz + azul de marca). */
export const STATUS_COLOR: Record<ReportStatus, string> = {
  pending: '#f59e0b',
  confirmed: '#040167',
  completed: '#059669',
  cancelled: '#dc2626',
}

export type StatusCounts = Record<ReportStatus, number>

export function countByStatus(rows: Pick<ApptRow, 'status'>[]): StatusCounts {
  const c: StatusCounts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 }
  for (const r of rows) c[r.status]++
  return c
}

/** Porcentaje con 1 decimal; null si el denominador es 0 (no se inventa un valor). */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * Comparación con el período anterior equivalente.
 *  - delta = actual − anterior (puntos porcentuales cuando el indicador es un porcentaje).
 *  - deltaPct = (actual − anterior) / anterior × 100; null si anterior = 0.
 */
export function compare(current: number | null, previous: number | null, isPercent = false): Comparison | null {
  if (current === null || previous === null) return null
  const delta = Math.round((current - previous) * 10) / 10
  return {
    previous,
    delta,
    deltaPct: isPercent || previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10,
  }
}

const ALL_STATUSES = 4

/**
 * Tasa de citas completadas = completadas ÷ (completadas + citas vencidas sin cerrar), solo sobre citas cuya
 * hora de fin ya pasó. NO es una tasa de asistencia:
 *  - El modelo de citas no registra inasistencias («no se presentó»), así que la asistencia real no es calculable.
 *  - Las canceladas quedan FUERA de la fórmula: una cancelación no es una inasistencia y no penaliza este indicador.
 *  - «Vencida sin cerrar» = pasada que sigue «pendiente» o «confirmada»: no se sabe si se atendió; no se da por
 *    atendida ni por ausente, simplemente no está completada todavía.
 *  - Se exige que haya al menos tantas completadas como vencidas sin cerrar; si no, «Datos insuficientes».
 */
export function completionRate(
  rows: Pick<ApptRow, 'status' | 'ends_at'>[],
  nowIso: string,
  statusFilter: ReportStatus[]
): { value: number | null; completed: number; denominator: number; unresolvedPast: number; insufficient?: string } {
  const past = rows.filter((r) => r.ends_at <= nowIso)
  const completed = past.filter((r) => r.status === 'completed').length
  const unresolvedPast = past.filter((r) => r.status === 'pending' || r.status === 'confirmed').length
  const denominator = completed + unresolvedPast
  const base = { completed, denominator, unresolvedPast }
  const needed: ReportStatus[] = ['completed', 'pending', 'confirmed']
  if (statusFilter.length && !needed.every((s) => statusFilter.includes(s))) {
    return { ...base, value: null, insufficient: 'El filtro de estado excluye completadas, pendientes o confirmadas; quítalo para calcular este indicador.' }
  }
  if (denominator === 0) {
    return { ...base, value: null, insufficient: 'No hay citas ya transcurridas y no canceladas en el período.' }
  }
  if (unresolvedPast > completed) {
    return {
      ...base,
      value: null,
      insufficient: `${unresolvedPast} citas pasadas siguen pendientes/confirmadas sin cerrar (más que las ${completed} completadas). Ciérralas como completadas o cancélalas para obtener un dato fiable.`,
    }
  }
  return { ...base, value: pct(completed, denominator) }
}

/**
 * Tasa de cancelación = canceladas ÷ citas programadas en el período (todos los estados, con los filtros
 * de motivo aplicados). Si hay un filtro de estado el denominador deja de ser «todas», así que no se calcula.
 */
export function cancellationRate(
  rows: Pick<ApptRow, 'status'>[],
  statusFilter: ReportStatus[]
): { value: number | null; insufficient?: string } {
  if (statusFilter.length && statusFilter.length < ALL_STATUSES) {
    return { value: null, insufficient: 'El filtro de estado altera el total de citas programadas; quítalo para calcular la tasa.' }
  }
  if (rows.length === 0) return { value: null, insufficient: 'No hay citas programadas en el período.' }
  return { value: pct(rows.filter((r) => r.status === 'cancelled').length, rows.length) }
}

// ------------------------------------------------------------------ series temporales

export type Granularity = 'day' | 'week' | 'month'

export function granularityFor(days: number): Granularity {
  return days <= 62 ? 'day' : days <= 183 ? 'week' : 'month'
}

function mondayOf(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1))
}

function bucketKey(date: string, g: Granularity): string {
  return g === 'day' ? date : g === 'week' ? mondayOf(date) : date.slice(0, 7)
}

function bucketLabel(key: string, g: Granularity): string {
  if (g === 'day') return `${key.slice(8)}/${key.slice(5, 7)}`
  if (g === 'week') return `${key.slice(8)}/${key.slice(5, 7)}`
  return DateTime.fromISO(`${key}-01`, { zone: 'utc' }).setLocale('es').toFormat('LLL yy')
}

/** Claves ordenadas de todos los intervalos entre `from` y `to` (incluye los vacíos). */
export function bucketKeys(from: string, to: string, g: Granularity): string[] {
  const keys: string[] = []
  let d = from
  while (d <= to) {
    const k = bucketKey(d, g)
    if (keys[keys.length - 1] !== k) keys.push(k)
    d = addDays(d, 1)
  }
  return keys
}

export function timeline(
  rows: Pick<ApptRow, 'starts_at' | 'status'>[],
  from: string,
  to: string,
  tz: string,
  g: Granularity
) {
  const keys = bucketKeys(from, to, g)
  const idx = new Map(keys.map((k, i) => [k, i]))
  const scheduled = keys.map(() => 0)
  const completed = keys.map(() => 0)
  const cancelled = keys.map(() => 0)
  for (const r of rows) {
    const i = idx.get(bucketKey(localDateOf(r.starts_at, tz), g))
    if (i === undefined) continue
    scheduled[i]!++
    if (r.status === 'completed') completed[i]!++
    if (r.status === 'cancelled') cancelled[i]!++
  }
  return { keys, labels: keys.map((k) => bucketLabel(k, g)), scheduled, completed, cancelled }
}

// ------------------------------------------------------------------ demanda

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Citas programadas por día de la semana local (lunes = 0). */
export function demandByWeekday(rows: Pick<ApptRow, 'starts_at'>[], tz: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const r of rows) out[toLocal(r.starts_at, tz).weekday - 1]!++
  return out
}

/** Citas programadas por hora local de inicio. Solo devuelve el rango de horas con actividad. */
export function demandByHour(rows: Pick<ApptRow, 'starts_at'>[], tz: string): { hours: number[]; counts: number[] } {
  const byHour = new Map<number, number>()
  for (const r of rows) {
    const h = toLocal(r.starts_at, tz).hour
    byHour.set(h, (byHour.get(h) ?? 0) + 1)
  }
  if (!byHour.size) return { hours: [], counts: [] }
  const min = Math.min(...byHour.keys())
  const max = Math.max(...byHour.keys())
  const hours = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return { hours, counts: hours.map((h) => byHour.get(h) ?? 0) }
}

// ------------------------------------------------------------------ motivos

/** Los motivos son texto libre: se agrupan sin distinguir mayúsculas ni espacios repetidos. */
export function reasonKey(reason: string): string {
  return reason.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type ReasonStat = { label: string; count: number; completed: number; cancelled: number }

export function reasonStats(rows: Pick<ApptRow, 'reason' | 'status'>[]): ReasonStat[] {
  const groups = new Map<string, { variants: Map<string, number>; count: number; completed: number; cancelled: number }>()
  for (const r of rows) {
    const k = reasonKey(r.reason)
    const g = groups.get(k) ?? { variants: new Map(), count: 0, completed: 0, cancelled: 0 }
    const v = r.reason.trim().replace(/\s+/g, ' ')
    g.variants.set(v, (g.variants.get(v) ?? 0) + 1)
    g.count++
    if (r.status === 'completed') g.completed++
    if (r.status === 'cancelled') g.cancelled++
    groups.set(k, g)
  }
  return [...groups.values()]
    .map((g) => ({
      label: [...g.variants.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      count: g.count,
      completed: g.completed,
      cancelled: g.cancelled,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'))
}

// ------------------------------------------------------------------ clientes

/**
 * Clientes nuevos / recurrentes entre los que tuvieron al menos una cita NO cancelada en el período.
 *  - Recurrente: tiene alguna cita no cancelada anterior al inicio del período.
 *  - Nuevo: su primera cita no cancelada del sistema cae dentro del período.
 *  - Solo es fiable si el sistema ya tenía citas antes del período; si no, todos parecerían «nuevos».
 */
export function clientSplit(
  rows: Pick<ApptRow, 'customer_id' | 'status'>[],
  priorCustomers: Set<number>,
  earliestVisit: string | null,
  periodStartUtc: string
): { total: number; newCount: number | null; recurringCount: number | null; insufficient?: string } {
  const ids = new Set(rows.filter((r) => r.status !== 'cancelled').map((r) => r.customer_id))
  const total = ids.size
  if (total === 0) return { total, newCount: 0, recurringCount: 0 }
  if (!earliestVisit || earliestVisit >= periodStartUtc) {
    return {
      total,
      newCount: null,
      recurringCount: null,
      insufficient: 'El sistema no tiene citas anteriores a este período, por lo que no se puede distinguir clientes nuevos de recurrentes.',
    }
  }
  let recurring = 0
  for (const id of ids) if (priorCustomers.has(id)) recurring++
  return { total, newCount: total - recurring, recurringCount: recurring }
}
