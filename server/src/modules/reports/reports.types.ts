/**
 * Contrato único de un informe. La pantalla y el PDF se generan A PARTIR DEL MISMO objeto `ReportData`
 * (calculado una sola vez en el backend), por lo que las cifras no pueden diferir entre ambos.
 */
export const REPORT_TYPES = [
  'operational',
  'daily',
  'weekly',
  'monthly',
  'clients',
  'cancellations',
  'reasons',
  'upcoming',
  'operations',
] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_TITLES: Record<ReportType, string> = {
  operational: 'Rendimiento operativo',
  daily: 'Informe diario',
  weekly: 'Informe semanal',
  monthly: 'Informe mensual',
  clients: 'Informe de clientes',
  cancellations: 'Cancelaciones y reprogramaciones',
  reasons: 'Motivos de visita',
  upcoming: 'Próximas citas',
  operations: 'Operaciones (depósitos y reembolsos)',
}

export type ReportStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed'

export type Comparison = {
  previous: number
  /** Diferencia absoluta (en puntos porcentuales si el indicador es un %). */
  delta: number
  /** Variación relativa en %; null si el período anterior vale 0 (no hay base de comparación). */
  deltaPct: number | null
}

export type Kpi = {
  key: string
  label: string
  /** null cuando no se puede calcular de forma fiable (ver `insufficient`). */
  value: number | null
  format: 'count' | 'percent' | 'money'
  /** Moneda ISO (solo `money`): los importes de monedas distintas nunca se suman ni se mezclan. */
  currency?: string
  hint?: string
  comparison?: Comparison | null
  /** Motivo por el que el indicador no se calcula («Datos insuficientes»). */
  insufficient?: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'gold'
}

export type ChartSpec = {
  id: string
  title: string
  kind: 'line' | 'bar' | 'groupedBar' | 'donut' | 'hbar'
  categories: string[]
  series: { name: string; values: number[]; color?: string }[]
  /** Colores por categoría (donut / hbar). */
  colors?: string[]
  note?: string
}

export type TableColumn = { key: string; label: string; align?: 'left' | 'right' | 'center'; weight?: number }

export type TableSpec = {
  id: string
  title: string
  columns: TableColumn[]
  rows: Record<string, string | number>[]
  totals?: Record<string, string | number>
  /** Filas que no caben en el informe (tope de seguridad); el total real va en `totalRows`. */
  omittedRows?: number
  totalRows: number
  emptyMessage: string
}

export type ReportFilters = {
  from: string
  to: string
  /** Estados de cita; en el informe de operaciones son estados de la operación (pending/confirmed/voided). */
  statuses: string[]
  reason: string
}

export type ReportData = {
  type: ReportType
  title: string
  subtitle: string
  business: string
  timezone: string
  generatedAt: string
  period: { from: string; to: string; days: number; previous: { from: string; to: string } | null }
  filters: ReportFilters
  /** Descripción legible de los filtros aplicados (se imprime en el PDF). */
  filterSummary: string[]
  empty: boolean
  emptyMessage: string
  kpis: Kpi[]
  charts: ChartSpec[]
  tables: TableSpec[]
  /** Definiciones y fórmulas de los indicadores y avisos sobre la calidad de los datos. */
  notes: string[]
}
