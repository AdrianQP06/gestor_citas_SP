import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Search, SearchX, Users } from 'lucide-react'
import { customersApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import { formatShortDate } from '@/lib/format'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/shared/empty-state'

const PAGE_SIZE = 15

export function CustomersPage() {
  const search = useSearch({ from: '/_authenticated/customers/' })
  const navigate = useNavigate({ from: '/customers/' })
  const page = search.page ?? 1
  const [text, setText] = useState(search.q ?? '')
  const debounced = useDebouncedValue(text)

  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      navigate({ search: { q: debounced || undefined }, replace: true })
    }
  }, [debounced, navigate, search.q])

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['customers', 'list', search.q ?? '', page],
    queryFn: () => customersApi.list(search.q ?? '', page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  })

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Page title='Clientes' description='Directorio de clientes con su historial de citas.'>
      <div className='space-y-4'>
        <div className='relative max-w-sm'>
          <Search className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Buscar por nombre, correo o teléfono'
            className='ps-9'
            aria-label='Buscar clientes'
          />
        </div>

        <div className='overflow-hidden rounded-lg border bg-card'>
          <Table>
            <TableHeader>
              <TableRow className='bg-muted/40 hover:bg-muted/40'>
                <TableHead>Cliente</TableHead>
                <TableHead className='hidden md:table-cell'>Teléfono</TableHead>
                <TableHead className='hidden text-end sm:table-cell'>Citas</TableHead>
                <TableHead className='hidden text-end sm:table-cell'>Próximas</TableHead>
                <TableHead className='hidden lg:table-cell'>Última cita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={isFetching && !isLoading ? 'opacity-60 transition-opacity' : ''}>
              {isLoading &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }, (_, j) => (
                      <TableCell key={j} className={j === 0 ? '' : 'hidden md:table-cell'}>
                        <Skeleton className='h-5 w-full max-w-36' />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {data?.items.map((c) => (
                <TableRow
                  key={c.id}
                  className='cursor-pointer'
                  tabIndex={0}
                  onClick={() => navigate({ to: '/customers/$customerId', params: { customerId: String(c.id) } })}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && navigate({ to: '/customers/$customerId', params: { customerId: String(c.id) } })
                  }
                >
                  <TableCell>
                    <div className='font-medium'>{c.fullName}</div>
                    <div className='text-xs text-muted-foreground'>{c.email}</div>
                  </TableCell>
                  <TableCell className='hidden md:table-cell'>{c.phone}</TableCell>
                  <TableCell className='hidden text-end tabular-nums sm:table-cell'>{c.totalAppointments}</TableCell>
                  <TableCell className='hidden text-end tabular-nums sm:table-cell'>{c.upcomingAppointments}</TableCell>
                  <TableCell className='hidden text-muted-foreground lg:table-cell'>
                    {c.lastAppointmentDate ? formatShortDate(c.lastAppointmentDate) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {error && (
            <EmptyState
              icon={SearchX}
              title='No se pudieron cargar los clientes'
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
              icon={search.q ? SearchX : Users}
              title={search.q ? 'Sin resultados' : 'Aún no hay clientes'}
              description={
                search.q
                  ? 'No hay clientes que coincidan con la búsqueda.'
                  : 'Los clientes se crean automáticamente al registrar o reservar una cita.'
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
