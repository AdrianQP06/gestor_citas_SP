import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { addDays, endOfMonth, startOfMonth, startOfWeek, todayIn } from '@/lib/format'
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_STYLES, STATUS_LABELS, STATUS_STYLES } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { AppointmentStatus, OperationStatus, ReportType } from '@/types/api'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type ReportFilterState = { from?: string; to?: string; status?: string; reason?: string }

type Props = {
  type: ReportType
  value: ReportFilterState
  /** Período efectivo del informe (el servidor aplica el suyo por defecto si no hay fechas). */
  period?: { from: string; to: string }
  reasons: string[]
  onChange: (patch: ReportFilterState) => void
  onReset: () => void
}

const APPT_STATUSES = Object.keys(STATUS_LABELS) as AppointmentStatus[]
const OP_STATUSES = Object.keys(OPERATION_STATUS_LABELS) as OperationStatus[]

export function FiltersBar({ type, value, period, reasons, onChange, onReset }: Props) {
  const tz = useTimezone()
  const today = todayIn(tz)
  const from = value.from ?? period?.from ?? ''
  const to = value.to ?? period?.to ?? ''
  const isOps = type === 'operations'
  const STATUSES: string[] = isOps ? OP_STATUSES : APPT_STATUSES
  const LABELS: Record<string, string> = isOps ? OPERATION_STATUS_LABELS : STATUS_LABELS
  const STYLES: Record<string, string> = isOps ? OPERATION_STATUS_STYLES : STATUS_STYLES
  const selected = (value.status ?? '').split(',').filter(Boolean)

  const presets = [
    { id: 'today', label: 'Hoy', from: today, to: today },
    { id: 'week', label: 'Esta semana', from: startOfWeek(today), to: addDays(startOfWeek(today), 6) },
    { id: 'month', label: 'Este mes', from: startOfMonth(today), to: endOfMonth(today) },
    { id: '7d', label: 'Últimos 7 días', from: addDays(today, -6), to: today },
    { id: '30d', label: 'Últimos 30 días', from: addDays(today, -29), to: today },
    { id: 'next30', label: 'Próximos 30 días', from: today, to: addDays(today, 30) },
  ]
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.id

  // El motivo se escribe libremente: se envía al servidor tras una pausa.
  const [reason, setReason] = useState(value.reason ?? '')
  const debounced = useDebouncedValue(reason, 400)
  useEffect(() => {
    if ((value.reason ?? '') !== debounced.trim()) onChange({ reason: debounced.trim() || undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const toggle = (s: string) => {
    const next = selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]
    onChange({ status: next.length ? next.join(',') : undefined })
  }
  const dirty = !!(value.from || value.to || value.status || value.reason)

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 shadow-soft">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Períodos rápidos">
        {presets.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={activePreset === p.id ? 'default' : 'outline'}
            aria-pressed={activePreset === p.id}
            onClick={() => onChange({ from: p.from, to: p.to })}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[auto_auto_1fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="rep-from">Desde</Label>
          <Input id="rep-from" type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value || undefined })} className="w-full xl:w-44" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rep-to">Hasta</Label>
          <Input id="rep-to" type="date" value={to} min={from || undefined} onChange={(e) => onChange({ to: e.target.value || undefined })} className="w-full xl:w-44" />
        </div>
        <div className="space-y-1.5">
          <Label>Estado</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={selected.includes(s)}
                onClick={() => toggle(s)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  selected.includes(s) ? STYLES[s] : 'text-muted-foreground hover:bg-muted',
                  selected.includes(s) && 'ring-1 ring-current/30'
                )}
              >
                {LABELS[s]}
              </button>
            ))}
            {selected.length === 0 && <span className="self-center text-xs text-muted-foreground">Todos</span>}
          </div>
        </div>
        {!isOps && (
        <div className="space-y-1.5">
          <Label htmlFor="rep-reason">Motivo contiene</Label>
          <Input id="rep-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: revisión" list="rep-reasons" maxLength={100} />
          <datalist id="rep-reasons">
            {reasons.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Los filtros se aplican igual a indicadores, gráficos, tablas y PDF. Máximo 366 días.</span>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setReason('')
              onReset()
            }}
          >
            <X /> Restablecer
          </Button>
        )}
      </div>
    </div>
  )
}
