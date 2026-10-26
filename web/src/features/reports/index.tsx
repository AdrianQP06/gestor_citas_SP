import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { AlertTriangle, Download, Eye } from 'lucide-react'
import { reportsApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ReportType } from '@/types/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Page } from '@/components/layout/page'
import { FiltersBar, type ReportFilterState } from './filters-bar'
import { PdfPreviewDialog } from './pdf-preview-dialog'
import { ReportView } from './report-view'

export function ReportsPage() {
  const { type } = useParams({ from: '/_authenticated/reports/$type' })
  const search = useSearch({ from: '/_authenticated/reports/$type' })
  const navigate = useNavigate({ from: '/reports/$type' })
  const [previewOpen, setPreviewOpen] = useState(false)

  const filters: ReportFilterState = { from: search.from, to: search.to, status: search.status, reason: search.reason }
  const options = useQuery({ queryKey: ['reports', 'options'], queryFn: reportsApi.options, staleTime: 5 * 60_000 })
  const report = useQuery({
    queryKey: ['reports', type, filters],
    queryFn: () => reportsApi.get(type as ReportType, filters),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const patch = (p: ReportFilterState) => navigate({ search: (s) => ({ ...s, ...p }), replace: true })
  const data = report.data
  const title = options.data?.types.find((t) => t.type === type)?.title ?? data?.title ?? 'Reportes'
  const pdfOk = !!data && !report.isError

  return (
    <Page
      title="Reportes"
      description="Indicadores y documentos de la actividad de citas, calculados con los datos reales."
      actions={
        <>
          <Button variant="outline" disabled={!pdfOk} onClick={() => setPreviewOpen(true)}>
            <Eye /> Vista previa PDF
          </Button>
          <Button asChild={pdfOk} disabled={!pdfOk}>
            {pdfOk ? (
              <a href={reportsApi.pdfUrl(type as ReportType, filters, true)}>
                <Download /> Descargar PDF
              </a>
            ) : (
              <span>
                <Download /> Descargar PDF
              </span>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <nav aria-label="Tipo de informe" className="-mx-1 overflow-x-auto px-1">
          <ul className="flex w-max gap-1 rounded-lg border bg-card p-1">
            {(options.data?.types ?? []).map((t) => (
              <li key={t.type}>
                <Link
                  to="/reports/$type"
                  params={{ type: t.type }}
                  // Los estados de «Operaciones» no son los de las citas: al cruzar esa frontera se descarta el filtro de estado.
                  search={(s) => ((t.type === 'operations') !== (type === 'operations') ? { ...s, status: undefined } : s)}
                  className={cn(
                    'block rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                    t.type === type ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  aria-current={t.type === type ? 'page' : undefined}
                >
                  {t.title}
                </Link>
              </li>
            ))}
            {options.isLoading && <Skeleton className="h-8 w-80" />}
          </ul>
        </nav>

        <FiltersBar
          type={type as ReportType}
          value={filters}
          period={data?.period}
          reasons={options.data?.reasons ?? []}
          onChange={patch}
          onReset={() => navigate({ search: {}, replace: true })}
        />

        {report.isError && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>No se pudo generar el informe</AlertTitle>
            <AlertDescription>{errorMessage(report.error)}</AlertDescription>
          </Alert>
        )}

        {report.isLoading && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-80" />
          </div>
        )}

        {data && !report.isError && (
          <div className={cn('space-y-4 transition-opacity', report.isFetching && 'opacity-60')}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{data.title}</h2>
                <p className="text-sm text-muted-foreground">{data.subtitle}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Generado el {formatDateTime(data.generatedAt, data.timezone)} · {data.timezone}
              </p>
            </div>
            <ul className="flex flex-wrap gap-2 text-xs">
              {data.filterSummary.map((f) => (
                <li key={f} className="rounded-full border bg-muted/50 px-3 py-1 text-muted-foreground">
                  {f}
                </li>
              ))}
            </ul>
            <ReportView report={data} />
          </div>
        )}
      </div>

      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={title}
        previewUrl={reportsApi.pdfUrl(type as ReportType, filters)}
        downloadUrl={reportsApi.pdfUrl(type as ReportType, filters, true)}
      />
    </Page>
  )
}
