import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarX2 } from 'lucide-react'
import { es } from 'react-day-picker/locale'
import { cn } from '@/lib/utils'
import { formatLongDate, monthOf, parseDate } from '@/lib/format'
import type { AvailableDay } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Skeleton } from '@/components/ui/skeleton'

export type SlotChoice = { date: string; time: string }

type SlotPickerProps = {
  /** Identifica el origen de datos en la caché (p. ej. ['portal'] o ['staff', excludeId]). */
  cacheKey: unknown[]
  fetchDays: (month: string) => Promise<AvailableDay[]>
  fetchSlots: (date: string) => Promise<{ time: string }[]>
  value: SlotChoice | null
  onChange: (value: SlotChoice | null) => void
  /** Hoy en la zona del negocio (AAAA-MM-DD). */
  today: string
  className?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDateString = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Selector de fecha + hora. La disponibilidad la calcula siempre el servidor. */
export function SlotPicker({
  cacheKey,
  fetchDays,
  fetchSlots,
  value,
  onChange,
  today,
  className,
}: SlotPickerProps) {
  const [month, setMonth] = useState(() => monthOf(value?.date ?? today))
  const [pickedDate, setPickedDate] = useState<string | null>(
    value?.date ?? null
  )

  const days = useQuery({
    queryKey: [...cacheKey, 'days', month],
    queryFn: () => fetchDays(month),
    placeholderData: keepPreviousData,
  })
  const available = useMemo(
    () => new Set((days.data ?? []).map((d) => d.date)),
    [days.data]
  )

  const slots = useQuery({
    queryKey: [...cacheKey, 'slots', pickedDate],
    queryFn: () => fetchSlots(pickedDate!),
    enabled: !!pickedDate,
  })

  // Si el horario preseleccionado (p. ej. al pulsar en el calendario) no es reservable, se descarta.
  useEffect(() => {
    if (slots.data && value && value.date === pickedDate && !slots.data.some((s) => s.time === value.time)) {
      onChange(null)
    }
  }, [slots.data, pickedDate, value, onChange])

  const morning = (slots.data ?? []).filter((s) => s.time < '14:00')
  const afternoon = (slots.data ?? []).filter((s) => s.time >= '14:00')
  const picked = pickedDate ? parseDate(pickedDate) : undefined
  const calendarSelected = picked
    ? new Date(picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate())
    : undefined
  const groups: [string, { time: string }[]][] = [
    ['Mañana', morning],
    ['Tarde', afternoon],
  ]

  return (
    <div className={cn('grid gap-6 md:grid-cols-[auto_1fr]', className)}>
      <div className='relative mx-auto md:mx-0'>
        <Calendar
          mode='single'
          locale={es}
          weekStartsOn={1}
          showOutsideDays={false}
          month={
            new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
          }
          onMonthChange={(d) => setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)}
          selected={calendarSelected}
          onSelect={(d) => d && setPickedDate(localDateString(d))}
          disabled={(d) => !available.has(localDateString(d))}
          className='rounded-lg border [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(11)]'
        />
        {days.isFetching && (
          <div className='pointer-events-none absolute inset-0 rounded-lg bg-background/40' />
        )}
        {days.isSuccess && days.data.length === 0 && (
          <p className='mt-3 text-center text-sm text-muted-foreground'>
            No hay días disponibles este mes.
          </p>
        )}
        <span className='sr-only'>Hoy es {today}</span>
      </div>

      <div className='min-w-0'>
        {!pickedDate && (
          <div className='flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
            Elige un día disponible para ver los horarios.
          </div>
        )}
        {pickedDate && (
          <div className='space-y-4'>
            <h3 className='text-sm font-medium'>{formatLongDate(pickedDate)}</h3>
            {slots.isLoading && (
              <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className='h-10' />
                ))}
              </div>
            )}
            {slots.isSuccess && slots.data.length === 0 && (
              <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                <CalendarX2 className='size-6' />
                Ya no quedan horarios este día. Prueba con otro.
              </div>
            )}
            {groups.map(
              ([label, list]) =>
                list.length > 0 && (
                  <div key={label}>
                    <p className='mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
                      {label}
                    </p>
                    <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
                      {list.map((s) => {
                        const selected =
                          value?.date === pickedDate && value.time === s.time
                        return (
                          <Button
                            key={s.time}
                            type='button'
                            variant={selected ? 'default' : 'outline'}
                            className='h-10 tabular-nums'
                            aria-pressed={selected}
                            onClick={() =>
                              onChange({ date: pickedDate, time: s.time })
                            }
                          >
                            {s.time}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
