import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Search, SearchX, X } from 'lucide-react'
import { appointmentsApi, type AppointmentFilters } from '@/api/services'
import { errorMessage } from '@/api/client'
import { addDays, formatMediumDate, todayIn } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/status'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { useAppointmentDialogs } from './appointment-dialogs'

const PAGE_SIZE = 15

export function AppointmentsPage() {
  const search = useSearch({ from: '/_authenticated/appointments' })
  const navigate = useNavigate({ from: '/appointments' })
  const timezone = useTimezone()
  const { openCreate, openDetail } = useAppointmentDialogs()

  const scope = search.scope ?? 'upcoming'
  const page = search.page ?? 1
  const [text, setText] = useState(search.q ?? '')
  const debounced = useDebouncedValue(text)

  // La búsqueda escrita se vuelca a la URL (compartible) tras una pausa.
  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      navigate({ search: (s) => ({ ...s, q: debounced || undefined, page: undefined }), replace: true })
    }
  }, [debounced, navigate, search.q])

  const today = todayIn(timezone)
  const filters: AppointmentFilters = {
    q: search.q,
    status: search.status ? [search.status] : undefined,
    from: search.from ?? (scope === 'upcoming' ? today : undefined),
    to: search.to ?? (scope === 'past' ? addDays(today, -1) : undefined),
    sort: scope === 'past' ? 'desc' : scope === 'upcoming' ? 'asc' : 'desc',
    page,
    pageSize: PAGE_SIZE,
  }

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['appointments', 'list', filters],
    queryFn: () => appointmentsApi.list(filters),
    placeholderData: keepPreviousData,
  })

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ search: (s) => ({ ...s, page: undefined, ...patch }) })

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(search.q || search.status || search.from || search.to)

  const clear = () => {
    setText('')
    navigate({ search: { scope: search.scope } })
  }

  return (
    <Page
      title='Citas'
      description='Busca, filtra y gestiona todas las citas.'
      actions={
        <Button onClick={() => openCreate()}>
          <Plus /> Nueva cita
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
          <Tabs value={scope} onValueChange={(v) => setSearch({ scope: v as typeof scope, from: undefined, to: undefined })}>
            <TabsList>
              <TabsTrigger value='upcoming'>Próximas</TabsTrigger>
              <TabsTrigger value='past'>Pasadas</TabsTrigger>
              <TabsTrigger value='all'>Todas</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className='relative min-w-0 flex-1 lg:max-w-sm'>
            <Search className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='Buscar por nombre, correo, teléfono o motivo'
              className='ps-9'
              aria-label='Buscar citas'
            />
          </div>
          <Select
            value={search.status ?? 'all'}
            onValueChange={(v) => setSearch({ status: v === 'all' ? undefined : (v as typeof search.status) })}
          >
            <SelectTrigger className='w-full lg:w-44' aria-label='Filtrar por estado'>
              <SelectValue placeholder='Estado' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Todos los estados</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className='flex items-center gap-2'>
            <Input
              type='date'
              value={search.from ?? ''}
              onChange={(e) => setSearch({ from: e.target.value || undefined })}
              aria-label='Desde'
              className='w-full lg:w-40'
            />
            <span className='text-muted-foreground'>–</span>
            <Input
              type='date'
              value={search.to ?? ''}
              onChange={(e) => setSearch({ to: e.target.value || undefined })}
              aria-label='Hasta'
              className='w-full lg:w-40'
            />
          </div>
          {hasFilters && (
            <Button variant='ghost' size='sm' onClick={clear}>
              <X /> Limpiar
            </Button>
          )}
        </div>

        <div className='overflow-hidden rounded-lg border bg-card'>
          <Table>
            <TableHeader>
              <TableRow className='bg-muted/40 hover:bg-muted/40'>
                <TableHead className='w-44'>Fecha y hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className='hidden md:table-cell'>Motivo</TableHead>
                <TableHead className='hidden lg:table-cell'>Origen</TableHead>
                <TableHead className='w-32'>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              {isLoading &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }, (_, j) => (
                      <TableCell key={j} className={j === 2 ? 'hidden md:table-cell' : j === 3 ? 'hidden lg:table-cell' : ''}>
                        <Skeleton className='h-5 w-full max-w-40' />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {data?.items.map((a) => (
                <TableRow
                  key={a.id}
                  className='cursor-pointer'
                  tabIndex={0}
                  onClick={() => openDetail(a.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openDetail(a.id)}
                >
                  <TableCell>
                    <div className='font-medium'>{formatMediumDate(a.date)}</div>
                    <div className='text-xs text-muted-foreground tabular-nums'>
                      {a.time} – {a.endTime}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='font-medium'>{a.customer.fullName}</div>
                    <div className='max-w-52 truncate text-xs text-muted-foreground'>{a.customer.email}</div>
                  </TableCell>
                  <TableCell className='hidden max-w-64 truncate md:table-cell'>{a.reason}</TableCell>
                  <TableCell className='hidden text-muted-foreground lg:table-cell'>
                    {a.source === 'portal' ? 'Portal' : 'Equipo'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {error && (
            <EmptyState
              icon={SearchX}
              title='No se pudieron cargar las citas'
              description={errorMessage(error)}
              action={
                <Button variant='outline' onClick={() => refetch()}>
                  Reintentar
                </Button>
              }
            />
          )}
          {!isLoading && !error && data?.items.length === 0 && (
            <EmptyState
              icon={hasFilters ? SearchX : ClipboardList}
              title={hasFilters ? 'Ninguna cita coincide con los filtros' : 'Todavía no hay citas aquí'}
              description={
                hasFilters
                  ? 'Prueba a cambiar la búsqueda o a quitar algún filtro.'
                  : 'Cuando se creen o reserven citas aparecerán en este listado.'
              }
              action={
                hasFilters ? (
                  <Button variant='outline' onClick={clear}>
                    Limpiar filtros
                  </Button>
                ) : (
                  <Button onClick={() => openCreate()}>
                    <Plus /> Nueva cita
                  </Button>
                )
              }
            />
          )}
        </div>

        {total > 0 && (
          <div className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='icon'
                disabled={page <= 1}
                onClick={() => navigate({ search: (s) => ({ ...s, page: page - 1 }) })}
                aria-label='Página anterior'
              >
                <ChevronLeft />
              </Button>
              <span className='tabular-nums'>
                {page} / {pages}
              </span>
              <Button
                variant='outline'
                size='icon'
                disabled={page >= pages}
                onClick={() => navigate({ search: (s) => ({ ...s, page: page + 1 }) })}
                aria-label='Página siguiente'
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}
