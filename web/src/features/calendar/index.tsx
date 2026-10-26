import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { calendarApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import {
  addDays,
  addMonths,
  eachDay,
  formatLongDate,
  formatMonth,
  formatShortDate,
  startOfMonth,
  startOfWeek,
  todayIn,
} from '@/lib/format'
import { useTimezone } from '@/hooks/use-settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Page } from '@/components/layout/page'
import { useAppointmentDialogs } from '@/features/appointments/appointment-dialogs'
import { MonthGrid } from './month-grid'
import { TimeGrid } from './time-grid'

type View = 'day' | 'week' | 'month'

function minutesNow(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

export function CalendarPage() {
  const timezone = useTimezone()
  const today = todayIn(timezone)
  const search = useSearch({ from: '/_authenticated/calendar' })
  const navigate = useNavigate({ from: '/calendar' })
  const { openCreate, openDetail } = useAppointmentDialogs()

  const view: View = search.view ?? 'week'
  const date = search.date ?? today
  const [showCancelled, setShowCancelled] = useState(false)
  const [nowMin, setNowMin] = useState(() => minutesNow(timezone))
  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesNow(timezone)), 60_000)
    return () => clearInterval(t)
  }, [timezone])

  const { days, from, to, title } = useMemo(() => {
    if (view === 'day') {
      return { days: [date], from: date, to: date, title: formatLongDate(date) }
    }
    if (view === 'week') {
      const start = startOfWeek(date)
      const list = eachDay(start, addDays(start, 6))
      return { days: list, from: list[0]!, to: list[6]!, title: `${formatShortDate(list[0]!)} – ${formatShortDate(list[6]!)} ${list[6]!.slice(0, 4)}` }
    }
    const start = startOfWeek(startOfMonth(date))
    const list = eachDay(start, addDays(start, 41))
    // Si la última fila queda entera fuera del mes, se omite.
    const trimmed = list[35]!.slice(0, 7) > date.slice(0, 7) ? list.slice(0, 35) : list
    return { days: trimmed, from: trimmed[0]!, to: trimmed[trimmed.length - 1]!, title: formatMonth(date) }
  }, [view, date])

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => calendarApi.range(from, to),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

  const go = (patch: { view?: View; date?: string }) =>
    navigate({ search: (s) => ({ ...s, ...patch }), replace: false })

  const shift = (dir: -1 | 1) => {
    if (view === 'day') go({ date: addDays(date, dir) })
    else if (view === 'week') go({ date: addDays(date, dir * 7) })
    else go({ date: addMonths(startOfMonth(date), dir) })
  }

  const cancelledCount = data?.appointments.filter((a) => a.status === 'cancelled').length ?? 0

  return (
    <Page
      title='Calendario'
      description='Tu agenda por día, semana o mes. Pulsa un hueco para crear una cita.'
      fixed={false}
      fluid
      actions={
        <Button onClick={() => openCreate({ date: view === 'month' ? undefined : date })}>
          <Plus /> Nueva cita
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-1'>
            <Button variant='outline' size='sm' onClick={() => go({ date: today })}>
              Hoy
            </Button>
            <Button variant='outline' size='icon' className='size-8' onClick={() => shift(-1)} aria-label='Anterior'>
              <ChevronLeft />
            </Button>
            <Button variant='outline' size='icon' className='size-8' onClick={() => shift(1)} aria-label='Siguiente'>
              <ChevronRight />
            </Button>
          </div>
          <h2 className='min-w-0 flex-1 text-lg font-semibold tracking-tight first-letter:uppercase' aria-live='polite'>
            {title}
          </h2>
          <div className='flex items-center gap-2'>
            <Checkbox
              id='show-cancelled'
              checked={showCancelled}
              onCheckedChange={(c) => setShowCancelled(c === true)}
            />
            <Label htmlFor='show-cancelled' className='text-sm font-normal'>
              Canceladas{cancelledCount > 0 && ` (${cancelledCount})`}
            </Label>
          </div>
          <Tabs value={view} onValueChange={(v) => go({ view: v as View })}>
            <TabsList>
              <TabsTrigger value='day'>Día</TabsTrigger>
              <TabsTrigger value='week'>Semana</TabsTrigger>
              <TabsTrigger value='month'>Mes</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {error && (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertDescription className='flex items-center gap-3'>
              {errorMessage(error)}
              <Button size='sm' variant='outline' onClick={() => refetch()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isLoading && <Skeleton className='h-[32rem] w-full rounded-lg' />}

        {data && (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            {view === 'month' ? (
              <MonthGrid
                days={days}
                month={date.slice(0, 7)}
                data={data}
                today={today}
                showCancelled={showCancelled}
                onCreate={(d) => openCreate({ date: d })}
                onOpen={openDetail}
                onDayClick={(d) => go({ view: 'day', date: d })}
              />
            ) : (
              <TimeGrid
                days={days}
                data={data}
                today={today}
                nowMinutes={nowMin}
                showCancelled={showCancelled}
                onCreate={(d, time) => openCreate({ date: d, time })}
                onOpen={openDetail}
                onDayClick={view === 'week' ? (d) => go({ view: 'day', date: d }) : undefined}
              />
            )}
          </div>
        )}

        <Legend />
      </div>
    </Page>
  )
}

function Legend() {
  const items = [
    ['bg-warning/60', 'Pendiente'],
    ['bg-primary/60', 'Confirmada'],
    ['bg-success/60', 'Completada'],
    ['bg-muted-foreground/40', 'Cerrado / descanso'],
    ['bg-destructive/40', 'Bloqueado'],
  ]
  return (
    <ul className='flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground'>
      {items.map(([cls, label]) => (
        <li key={label} className='flex items-center gap-1.5'>
          <span className={`size-2.5 rounded-sm ${cls}`} /> {label}
        </li>
      ))}
    </ul>
  )
}
