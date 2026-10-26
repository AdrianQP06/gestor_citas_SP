import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatWeekdayShort, toMinutes } from '@/lib/format'
import { EVENT_STYLES } from '@/lib/status'
import type { Appointment, CalendarData } from '@/types/api'
import { blockSegment, dayWindow, layoutEvents } from './layout'

const HOUR_PX = 60
const DEFAULT_START = 8 * 60
const DEFAULT_END = 19 * 60

const pad = (n: number) => String(n).padStart(2, '0')
const toTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

type Props = {
  days: string[]
  data: CalendarData
  today: string
  /** Hora actual en la zona del negocio (minutos desde medianoche). */
  nowMinutes: number
  showCancelled: boolean
  onCreate: (date: string, time: string) => void
  onOpen: (id: number) => void
  onDayClick?: (date: string) => void
}

const stripes =
  'bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,var(--border)_5px,var(--border)_6px)]'

export function TimeGrid({ days, data, today, nowMinutes, showCancelled, onCreate, onOpen, onDayClick }: Props) {
  // Rango vertical: de la primera apertura a la última hora de cierre (y cualquier cita fuera de horario).
  const windows = days.map((d) => dayWindow(d, data))
  let start = Infinity
  let end = -Infinity
  windows.forEach((w) => {
    if (!w.closed) {
      start = Math.min(start, w.open)
      end = Math.max(end, w.close)
    }
  })
  for (const a of data.appointments) {
    if (!days.includes(a.date) || (!showCancelled && a.status === 'cancelled')) continue
    start = Math.min(start, toMinutes(a.time))
    end = Math.max(end, toMinutes(a.endTime))
  }
  if (!Number.isFinite(start)) {
    start = DEFAULT_START
    end = DEFAULT_END
  }
  const gridStart = Math.floor(start / 60) * 60
  const gridEnd = Math.min(24 * 60, Math.ceil(end / 60) * 60)
  const hours = Array.from({ length: (gridEnd - gridStart) / 60 }, (_, i) => gridStart / 60 + i)
  const height = ((gridEnd - gridStart) / 60) * HOUR_PX
  const y = (min: number) => ((min - gridStart) / 60) * HOUR_PX

  const step = data.durationMin + data.bufferMin

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>, date: string, openAt: number | null) => {
    if ((e.target as HTMLElement).closest('[data-event]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clicked = gridStart + ((e.clientY - rect.top) / HOUR_PX) * 60
    // Ajusta a la rejilla de horarios del día (apertura + k·(duración+intervalo)).
    const base = openAt ?? gridStart
    const snapped = base + Math.max(0, Math.floor((clicked - base) / step)) * step
    onCreate(date, toTime(Math.min(snapped, 24 * 60 - 1)))
  }

  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className='overflow-auto rounded-lg border bg-card' data-testid='time-grid'>
      <div style={{ minWidth: days.length > 1 ? 760 : 0 }}>
        {/* Cabecera de días */}
        <div
          className='sticky top-0 z-20 grid border-b bg-card/95 backdrop-blur'
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((d, i) => {
            const w = windows[i]!
            const isToday = d === today
            return (
              <button
                key={d}
                type='button'
                onClick={() => onDayClick?.(d)}
                disabled={!onDayClick}
                className={cn(
                  'border-s px-2 py-2 text-center transition-colors',
                  onDayClick && 'hover:bg-muted/50'
                )}
              >
                <div className='text-xs text-muted-foreground uppercase'>{formatWeekdayShort(d)}</div>
                <div
                  className={cn(
                    'mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-base font-semibold',
                    isToday && 'bg-primary text-primary-foreground'
                  )}
                >
                  {Number(d.slice(8))}
                </div>
                {w.closed && w.label && (
                  <div className='mt-1 truncate text-[11px] font-medium text-destructive'>{w.label}</div>
                )}
              </button>
            )
          })}
        </div>

        <div className='grid' style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Eje de horas */}
          <div className='relative' style={{ height }}>
            {hours.map((h) => (
              <div
                key={h}
                className='absolute end-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums'
                style={{ top: y(h * 60) }}
              >
                {h > gridStart / 60 && `${pad(h)}:00`}
              </div>
            ))}
          </div>

          {days.map((date, i) => {
            const w = windows[i]!
            const events = layoutEvents(
              data.appointments.filter((a) => a.date === date && (showCancelled || a.status !== 'cancelled'))
            )
            const blocks = data.blocks
              .map((b) => ({ b, seg: blockSegment(b, date) }))
              .filter((x): x is { b: typeof x.b; seg: { from: number; to: number } } => !!x.seg)
            const isToday = date === today
            return (
              <div
                key={date}
                className={cn('relative border-s', w.closed && 'bg-muted/40')}
                style={{ height }}
                onClick={(e) => !w.closed && handleColumnClick(e, date, w.closed ? null : w.open)}
                data-date={date}
              >
                {hours.map((h) => (
                  <div key={h} className='absolute inset-x-0 border-t border-border/70' style={{ top: y(h * 60) }} />
                ))}
                {w.closed && <div className={cn('absolute inset-0 opacity-60', stripes)} />}
                {!w.closed && (
                  <>
                    {w.open > gridStart && (
                      <div className='absolute inset-x-0 bg-muted/60' style={{ top: 0, height: y(w.open) }} />
                    )}
                    {w.close < gridEnd && (
                      <div className='absolute inset-x-0 bg-muted/60' style={{ top: y(w.close), bottom: 0 }} />
                    )}
                    {w.breakStart !== null && w.breakEnd !== null && (
                      <div
                        className={cn('absolute inset-x-0 bg-muted/60', stripes)}
                        style={{ top: y(w.breakStart), height: y(w.breakEnd) - y(w.breakStart) }}
                        title='Descanso'
                      />
                    )}
                  </>
                )}
                {blocks.map(({ b, seg }) => (
                  <div
                    key={b.id}
                    className={cn(
                      'pointer-events-none absolute inset-x-0 border-y border-destructive/30 bg-destructive/10 px-1 py-0.5 text-[11px] text-destructive',
                      stripes
                    )}
                    style={{ top: y(Math.max(seg.from, gridStart)), height: y(Math.min(seg.to, gridEnd)) - y(Math.max(seg.from, gridStart)) }}
                  >
                    <span className='rounded bg-background/80 px-1'>Bloqueado{b.reason ? `: ${b.reason}` : ''}</span>
                  </div>
                ))}

                {events.map(({ appt, col, cols }) => (
                  <EventButton
                    key={appt.id}
                    appt={appt}
                    top={y(toMinutes(appt.time))}
                    height={Math.max(22, y(toMinutes(appt.endTime)) - y(toMinutes(appt.time)))}
                    col={col}
                    cols={cols}
                    onOpen={onOpen}
                  />
                ))}

                {isToday && nowMinutes >= gridStart && nowMinutes <= gridEnd && (
                  <div className='pointer-events-none absolute inset-x-0 z-10 flex items-center' style={{ top: y(nowMinutes) }}>
                    <span className='-ms-1 size-2 rounded-full bg-destructive' />
                    <span className='h-px flex-1 bg-destructive' />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventButton({
  appt,
  top,
  height,
  col,
  cols,
  onOpen,
}: {
  appt: Appointment
  top: number
  height: number
  col: number
  cols: number
  onOpen: (id: number) => void
}) {
  return (
    <button
      type='button'
      data-event
      onClick={() => onOpen(appt.id)}
      title={`${appt.time} · ${appt.customer.fullName} · ${appt.reason}`}
      className={cn(
        'absolute z-[5] overflow-hidden rounded-md border border-l-4 px-1.5 py-0.5 text-start text-xs leading-tight shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        EVENT_STYLES[appt.status]
      )}
      style={{
        top: top + 1,
        height: height - 2,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
      }}
    >
      <span className='block truncate font-medium'>
        <span className='tabular-nums'>{appt.time}</span> {appt.customer.fullName}
      </span>
      {height >= 44 && <span className='block truncate text-muted-foreground'>{appt.reason}</span>}
    </button>
  )
}
