import { z } from 'zod'
import { DATE_RE, addDays, dayBoundsUtc, todayLocal } from '../../shared/time.ts'
import { OPERATION_STATUSES, type OperationStatus } from '../operations/operations.schemas.ts'
import { REPORT_TYPES, type ReportFilters, type ReportStatus, type ReportType } from './reports.types.ts'

export const MAX_RANGE_DAYS = 366

const STATUS_VALUES: ReportStatus[] = ['pending', 'confirmed', 'cancelled', 'completed']

/** Parámetros de consulta (filtros compartidos por pantalla, gráficos y PDF). */
export const reportQuerySchema = z.object({
  from: z.string().regex(DATE_RE, 'Fecha «desde» no válida.').optional(),
  to: z.string().regex(DATE_RE, 'Fecha «hasta» no válida.').optional(),
  status: z.string().max(80).optional(),
  reason: z.string().trim().max(100).optional(),
  download: z.enum(['1', '0']).optional(),
})

export const reportTypeSchema = z.enum(REPORT_TYPES, { error: 'Tipo de informe no válido.' })

export class ReportInputError extends Error {
  fields: Record<string, string>
  constructor(message: string, field: string) {
    super(message)
    this.fields = { [field]: message }
  }
}

function isRealDate(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}

/** Períodos por defecto de cada informe, en la zona horaria del negocio. */
export function defaultPeriod(type: ReportType, today: string): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`)
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7))
  switch (type) {
    case 'daily':
      return { from: today, to: today }
    case 'weekly':
      return { from: monday, to: addDays(monday, 6) }
    case 'monthly': {
      const first = `${today.slice(0, 7)}-01`
      const next = new Date(`${first}T12:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) }
    }
    case 'upcoming':
      return { from: today, to: addDays(today, 30) }
    case 'clients':
      return { from: addDays(today, -89), to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export type ResolvedFilters = Omit<ReportFilters, 'statuses'> & {
  /** Estados de cita (todos los informes salvo «operations»). */
  statuses: ReportStatus[]
  /** Estados de operación (solo el informe «operations»). */
  opStatuses: OperationStatus[]
  days: number
  startUtc: string
  endUtc: string
  previous: { from: string; to: string; startUtc: string; endUtc: string } | null
}

/**
 * Valida y completa los filtros. Fechas locales del negocio (inclusivas); el rango no puede superar
 * `MAX_RANGE_DAYS` días. El «período anterior equivalente» tiene la misma duración y termina el día antes.
 */
export function resolveFilters(
  type: ReportType,
  input: z.infer<typeof reportQuerySchema>,
  tz: string,
  now?: import('luxon').DateTime
): ResolvedFilters {
  const today = todayLocal(tz, now)
  const def = defaultPeriod(type, today)
  const from = input.from ?? def.from
  const to = input.to ?? def.to
  if (!isRealDate(from)) throw new ReportInputError('La fecha «desde» no es válida.', 'from')
  if (!isRealDate(to)) throw new ReportInputError('La fecha «hasta» no es válida.', 'to')
  if (from < '2000-01-01' || to > '2100-12-31') throw new ReportInputError('Las fechas están fuera de rango.', 'from')
  if (to < from) throw new ReportInputError('La fecha «hasta» no puede ser anterior a «desde».', 'to')
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  if (days > MAX_RANGE_DAYS) {
    throw new ReportInputError(`El período no puede superar ${MAX_RANGE_DAYS} días (has pedido ${days}).`, 'to')
  }

  // El filtro «status» significa estado de la CITA en los informes de citas y estado de la OPERACIÓN en el de operaciones.
  const allowed: readonly string[] = type === 'operations' ? OPERATION_STATUSES : STATUS_VALUES
  let picked: string[] = []
  if (input.status) {
    const wanted = input.status.split(',').map((s) => s.trim()).filter(Boolean)
    const bad = wanted.find((s) => !allowed.includes(s))
    if (bad) throw new ReportInputError(`Estado no válido: ${bad}.`, 'status')
    picked = [...new Set(wanted)]
    if (picked.length === allowed.length) picked = [] // todos = sin filtro
  }
  const statuses = (type === 'operations' ? [] : picked) as ReportStatus[]
  const opStatuses = (type === 'operations' ? picked : []) as OperationStatus[]

  const prevTo = addDays(from, -1)
  const prevFrom = addDays(prevTo, -(days - 1))
  const previous =
    type === 'operational'
      ? {
          from: prevFrom,
          to: prevTo,
          startUtc: dayBoundsUtc(prevFrom, tz).start,
          endUtc: dayBoundsUtc(prevTo, tz).end,
        }
      : null

  return {
    from,
    to,
    statuses,
    opStatuses,
    reason: type === 'operations' ? '' : (input.reason ?? ''),
    days,
    startUtc: dayBoundsUtc(from, tz).start,
    endUtc: dayBoundsUtc(to, tz).end,
    previous,
  }
}
