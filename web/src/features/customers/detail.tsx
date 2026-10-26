import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Plus, UserX } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { customersApi } from '@/api/services'
import { formatMediumDate } from '@/lib/format'
import { applyServerErrors, customerEditSchema, type CustomerEditValues } from '@/validation/forms'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { useAppointmentDialogs } from '@/features/appointments/appointment-dialogs'

export function CustomerDetailPage() {
  const { customerId } = useParams({ from: '/_authenticated/customers/$customerId' })
  const id = Number(customerId)
  const queryClient = useQueryClient()
  const { openCreate, openDetail } = useAppointmentDialogs()

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => customersApi.get(id),
    enabled: Number.isInteger(id),
  })

  const form = useForm<CustomerEditValues>({
    resolver: zodResolver(customerEditSchema),
    defaultValues: { fullName: '', phone: '', email: '', notes: '' },
  })

  useEffect(() => {
    if (data) {
      const c = data.customer
      form.reset({ fullName: c.fullName, phone: c.phone, email: c.email, notes: c.notes })
    }
  }, [data, form])

  const save = useMutation({
    mutationFn: (v: CustomerEditValues) => customersApi.update(id, v),
    onSuccess: () => {
      toast.success('Cliente actualizado.')
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (e) => {
      if (!applyServerErrors(form, e)) toast.error(errorMessage(e))
    },
  })

  if (error) {
    return (
      <Page title='Cliente'>
        <EmptyState
          icon={UserX}
          title={error instanceof ApiError && error.status === 404 ? 'Este cliente no existe' : 'No se pudo cargar'}
          description={errorMessage(error)}
          action={
            <Button asChild variant='outline'>
              <Link to='/customers'>Volver a clientes</Link>
            </Button>
          }
        />
      </Page>
    )
  }

  const customer = data?.customer

  return (
    <Page
      title={customer?.fullName ?? 'Cliente'}
      description={customer ? `Cliente desde ${formatMediumDate(customer.createdAt.slice(0, 10))}` : undefined}
      actions={
        <>
          <Button variant='outline' asChild>
            <Link to='/customers'>
              <ArrowLeft /> Clientes
            </Link>
          </Button>
          {customer && (
            <Button
              onClick={() =>
                openCreate({
                  customer: { id: customer.id, fullName: customer.fullName, phone: customer.phone, email: customer.email },
                })
              }
            >
              <Plus /> Nueva cita
            </Button>
          )}
        </>
      }
    >
      <div className='grid gap-6 lg:grid-cols-5'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>Datos del cliente</CardTitle>
            <CardDescription>Se actualizan en todas sus citas.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='space-y-4'>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className='h-10' />
                ))}
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-4' noValidate>
                  <FormField
                    control={form.control}
                    name='fullName'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre completo</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='phone'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teléfono</FormLabel>
                        <FormControl>
                          <Input type='tel' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='email'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Correo electrónico</FormLabel>
                        <FormControl>
                          <Input type='email' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='notes'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notas sobre el cliente</FormLabel>
                        <FormControl>
                          <Textarea rows={4} placeholder='Preferencias, avisos… (solo equipo)' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type='submit' disabled={!form.formState.isDirty || save.isPending}>
                    {save.isPending && <Loader2 className='animate-spin' />}
                    Guardar cambios
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card className='lg:col-span-3'>
          <CardHeader>
            <CardTitle>Historial de citas</CardTitle>
            <CardDescription>
              {customer
                ? `${customer.totalAppointments} en total · ${customer.upcomingAppointments} próximas`
                : 'Cargando…'}
            </CardDescription>
          </CardHeader>
          <CardContent className='px-0'>
            {data && data.appointments.length === 0 && (
              <EmptyState icon={Plus} title='Sin citas todavía' description='Crea la primera cita de este cliente.' />
            )}
            {data && data.appointments.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.appointments.map((a) => (
                    <TableRow
                      key={a.id}
                      className='cursor-pointer'
                      tabIndex={0}
                      onClick={() => openDetail(a.id)}
                      onKeyDown={(e) => e.key === 'Enter' && openDetail(a.id)}
                    >
                      <TableCell>
                        <div className='font-medium'>{formatMediumDate(a.date)}</div>
                        <div className='text-xs text-muted-foreground tabular-nums'>{a.time}</div>
                      </TableCell>
                      <TableCell className='max-w-56 truncate'>{a.reason}</TableCell>
                      <TableCell>
                        <StatusBadge status={a.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {isLoading && <Skeleton className='mx-6 h-32' />}
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
