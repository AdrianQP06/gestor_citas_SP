import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, FileSearch, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/status'
import type { AppointmentStatus, ReportData, ReportKpi, ReportTable } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import { ReportChartView } from './report-charts'

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const moneyFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))}`

const TONE: Record<NonNullable<ReportKpi['tone']>, string> = {
  default: 'text-primary',
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-destructive',
  gold: 'text-gold',
}
const BAR: Record<NonNullable<ReportKpi['tone']>, string> = {
  default: 'bg-primary',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
  gold: 'bg-gold',
}
const LOWER_IS_BETTER = new Set(['cancelled', 'cancellation_rate', 'pending'])

function Comparison({ kpi }: { kpi: ReportKpi }) {
  const c = kpi.comparison
  if (!c) return null
  const good = LOWER_IS_BETTER.has(kpi.key) ? c.delta <= 0 : c.delta >= 0
  const color = c.delta === 0 ? 'text-muted-foreground' : good ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'
  const prev = kpi.format === 'percent' ? `${nf.format(c.previous)} %` : nf.format(c.previous)
  const text =
    kpi.format === 'percent'
      ? `${signed(c.delta)} pp`
      : c.deltaPct === null
        ? `${signed(c.delta)} · sin base de comparación`
        : `${signed(c.delta)} (${signed(c.deltaPct)} %)`
  return (
    <p className={cn('mt-1 text-xs font-medium', color)}>
      {text} <span className="font-normal text-muted-foreground">vs. anterior ({prev})</span>
    </p>
  )
}

function KpiCard({ kpi }: { kpi: ReportKpi }) {
  const tone = kpi.tone ?? 'default'
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="relative p-4 ps-5">
        <span className={cn('absolute inset-y-3 start-0 w-1 rounded-e', BAR[tone])} />
        <p className="text-sm text-muted-foreground">{kpi.label}</p>
        {kpi.value === null ? (
          <>
            <p className="mt-1 text-lg font-semibold text-muted-foreground">Datos insuficientes</p>
            {kpi.insufficient && <p className="mt-1 text-xs text-muted-foreground">{kpi.insufficient}</p>}
          </>
        ) : (
          <>
            <p className={cn('mt-1 text-3xl font-bold tracking-tight tabular-nums', TONE[tone])}>
              {kpi.format === 'money' ? moneyFmt.format(kpi.value) : nf.format(kpi.value)}
              {kpi.format === 'percent' && <span className="text-xl"> %</span>}
              {kpi.format === 'money' && <span className="text-xl"> {kpi.currency}</span>}
            </p>
            <Comparison kpi={kpi} />
            {kpi.hint && <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [v, k])) as Record<string, AppointmentStatus>
const PAGE_SIZE = 25

function DataTable({ table }: { table: ReportTable }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE))
  const slice = table.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const align = (a?: string) => (a === 'right' ? 'text-end' : a === 'center' ? 'text-center' : '')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{table.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {table.rows.length === 0 ? (
          <p className="px-6 pb-2 text-sm text-muted-foreground">{table.emptyMessage}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {table.columns.map((c) => (
                    <TableHead key={c.key} className={align(c.align)}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((row, i) => (
                  <TableRow key={`${page}-${i}`}>
                    {table.columns.map((c) => {
                      const v = row[c.key]
                      const status = c.key === 'status' ? STATUS_BY_LABEL[String(v)] : undefined
                      return (
                        <TableCell key={c.key} className={cn(align(c.align), 'max-w-72 truncate tabular-nums')}>
                          {status ? (
                            <Badge variant="outline" className={cn('font-medium', STATUS_STYLES[status])}>
                              {String(v)}
                            </Badge>
                          ) : typeof v === 'number' ? (
                            nf.format(v)
                          ) : (
                            v
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
              {table.totals && (
                <TableFooter>
                  <TableRow className="bg-primary/5 font-semibold hover:bg-primary/5">
                    {table.columns.map((c) => {
                      const v = table.totals![c.key]
                      return (
                        <TableCell key={c.key} className={cn(align(c.align), 'tabular-nums')}>
                          {typeof v === 'number' ? nf.format(v) : (v ?? '')}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
        {(pages > 1 || table.omittedRows) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-3 text-sm text-muted-foreground">
            <span>
              {table.omittedRows
                ? `Se muestran ${nf.format(table.rows.length)} de ${nf.format(table.totalRows)} filas (tope de seguridad).`
                : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, table.rows.length)} de ${nf.format(table.rows.length)}`}
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="size-8" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                  <ChevronLeft />
                </Button>
                <span className="tabular-nums">
                  {page + 1} / {pages}
                </span>
                <Button variant="outline" size="icon" className="size-8" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ReportView({ report }: { report: ReportData }) {
  const [showNotes, setShowNotes] = useState(false)
  return (
    <div className="space-y-6">
      {report.empty && (
        <Card>
          <EmptyState icon={FileSearch} title="Sin resultados" description={report.emptyMessage} />
        </Card>
      )}

      {report.kpis.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {report.kpis.map((k) => (
            <KpiCard key={k.key} kpi={k} />
          ))}
        </div>
      )}

      {report.charts.length > 0 && (
        <Card>
          <CardContent className="grid gap-8 pt-6 lg:grid-cols-2">
            {report.charts.map((c) => (
              <div key={c.id} className={c.kind === 'line' || c.categories.length > 14 ? 'lg:col-span-2' : undefined}>
                <ReportChartView chart={c} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {report.tables.map((t) => (
        <DataTable key={t.id} table={t} />
      ))}

      {report.notes.length > 0 && (
        <Card>
          <CardHeader>
            <button type="button" className="flex w-full items-center justify-between text-start" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4 text-primary" /> Definiciones y fórmulas
              </CardTitle>
              <ChevronDown className={cn('size-4 transition-transform', showNotes && 'rotate-180')} />
            </button>
          </CardHeader>
          {showNotes && (
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {report.notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                    {n}
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
