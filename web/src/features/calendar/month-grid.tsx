import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatWeekdayShort } from '@/lib/format'
import { EVENT_STYLES } from '@/lib/status'
import type { CalendarData } from '@/types/api'
import { dayWindow } from './layout'

const MAX_VISIBLE = 3

type Props = {
  days: string[]
  month: string
  data: CalendarData
  today: string
  showCancelled: boolean
  onCreate: (date: string) => void
  onOpen: (id: number) => void
  onDayClick: (date: string) => void
}

export function MonthGrid({ days, month, data, today, showCancelled, onCreate, onOpen, onDayClick }: Props) {
  return (
    <div className='overflow-auto rounded-lg border bg-card' data-testid='month-grid'>
      <div className='min-w-[640px]'>
        <div className='grid grid-cols-7 border-b bg-muted/30'>
          {days.slice(0, 7).map((d) => (
            <div key={d} className='px-2 py-2 text-center text-xs font-medium text-muted-foreground uppercase'>
              {formatWeekdayShort(d)}
            </div>
          ))}
        </div>
        <div className='grid grid-cols-7'>
          {days.map((date) => {
            const w = dayWindow(date, data)
            const events = data.appointments.filter((a) => a.date === date && (showCancelled || a.status !== 'cancelled'))
            const inMonth = date.slice(0, 7) === month
            const isToday = date === today
            return (
              <div
                key={date}
                className={cn(
                  'group relative min-h-28 border-s border-b p-1.5 first:border-s-0 [&:nth-child(7n+1)]:border-s-0',
                  !inMonth && 'bg-muted/30 text-muted-foreground',
                  w.closed && inMonth && 'bg-muted/40'
                )}
              >
                <div className='flex items-center justify-between'>
                  <button
                    type='button'
                    onClick={() => onDayClick(date)}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-sm hover:bg-muted',
                      isToday && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90'
                    )}
                    aria-label={`Ver el día ${date}`}
                  >
                    {Number(date.slice(8))}
                  </button>
                  {!w.closed && inMonth && (
                    <button
                      type='button'
                      onClick={() => onCreate(date)}
                      className='flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100'
                      aria-label='Nueva cita este día'
                    >
                      <Plus className='size-4' />
                    </button>
                  )}
                </div>
                {w.closed && w.label && (
                  <p className='mt-0.5 truncate px-1 text-[11px] font-medium text-destructive'>{w.label}</p>
                )}
                <ul className='mt-1 space-y-0.5'>
                  {events.slice(0, MAX_VISIBLE).map((a) => (
                    <li key={a.id}>
                      <button
                        type='button'
                        onClick={() => onOpen(a.id)}
                        className={cn(
                          'w-full truncate rounded border border-l-[3px] px-1 py-0.5 text-start text-[11px] leading-tight transition-colors',
                          EVENT_STYLES[a.status]
                        )}
                        title={`${a.time} · ${a.customer.fullName}`}
                      >
                        <span className='tabular-nums'>{a.time}</span> {a.customer.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
                {events.length > MAX_VISIBLE && (
                  <button
                    type='button'
                    onClick={() => onDayClick(date)}
                    className='mt-0.5 px-1 text-[11px] font-medium text-primary hover:underline'
                  >
                    +{events.length - MAX_VISIBLE} más
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
