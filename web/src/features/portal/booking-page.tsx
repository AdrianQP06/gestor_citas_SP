import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, CalendarClock, CalendarOff, Check, CheckCircle2, Clock3, Copy, Download, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { portalApi } from '@/api/services'
import { formatLongDate, todayIn } from '@/lib/format'
import { cn } from '@/lib/utils'
import { applyServerErrors, bookingSchema, type BookingValues } from '@/validation/forms'
import type { PublicAppointment } from '@/types/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/shared/empty-state'
import { SlotPicker, type SlotChoice } from '@/components/shared/slot-picker'
import { AppointmentSummary } from './appointment-summary'
import { buildIcs, downloadIcs } from './ics'
import { PortalShell } from './portal-shell'
import { usePortalInfo } from './use-portal-info'

const STEPS = ['Fecha y hora', 'Tus datos', 'Confirmación']

// El campo trampa viaja en la petición: el servidor rechaza cualquier valor no vacío.
const portalSchema = bookingSchema.extend({ website: z.string() })

function Stepper({ step }: { step: number }) {
  return (
    <ol className='mb-6 flex items-center gap-2 text-sm' aria-label='Progreso de la reserva'>
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        return (
          <li key={label} className='flex flex-1 items-center gap-2' aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                current && 'border-primary text-primary',
                !done && !current && 'text-muted-foreground'
              )}
            >
              {done ? <Check className='size-4' /> : i + 1}
            </span>
            <span className={cn('hidden truncate sm:block', current ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className='h-px flex-1 bg-border' />}
          </li>
        )
      })}
    </ol>
  )
}

export function BookingPage() {
  const { data: info, isLoading, error } = usePortalInfo()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [slot, setSlot] = useState<SlotChoice | null>(null)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [booked, setBooked] = useState<PublicAppointment | null>(null)

  const form = useForm<BookingValues & { website: string }>({
    resolver: zodResolver(portalSchema),
    defaultValues: { fullName: '', phone: '', email: '', reason: '', website: '' },
  })

  const book = useMutation({
    mutationFn: (v: BookingValues & { website: string }) =>
      portalApi.book({ ...v, date: slot!.date, time: slot!.time }),
    onSuccess: (a) => {
      setBooked(a)
      setStep(2)
      queryClient.invalidateQueries({ queryKey: ['portal'] })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (e) => {
      if (applyServerErrors(form, e)) return
      if (e instanceof ApiError && e.code === 'slot_unavailable') {
        // Alguien reservó ese hueco antes: se vuelve a elegir horario con la disponibilidad actualizada.
        setSlotError(e.message)
        setSlot(null)
        setStep(0)
        queryClient.invalidateQueries({ queryKey: ['portal'] })
      } else setFormError(errorMessage(e))
    },
  })

  if (isLoading) {
    return (
      <PortalShell>
        <Skeleton className='h-96 w-full rounded-xl' />
      </PortalShell>
    )
  }
  if (error || !info) {
    return (
      <PortalShell>
        <EmptyState
          icon={CalendarOff}
          title='No se pudo cargar la reserva'
          description={error ? errorMessage(error) : 'Inténtalo de nuevo en unos minutos.'}
          action={<Button onClick={() => window.location.reload()}>Reintentar</Button>}
        />
      </PortalShell>
    )
  }
  if (!info.enabled) {
    return (
      <PortalShell info={info}>
        <EmptyState
          icon={CalendarOff}
          title='Las reservas online no están disponibles'
          description={`Ahora mismo no se aceptan reservas por internet.${info.phone ? ` Llámanos al ${info.phone}.` : ' Contacta directamente con nosotros.'}`}
        />
      </PortalShell>
    )
  }

  const today = todayIn(info.timezone)

  if (step === 2 && booked) {
    return (
      <PortalShell info={info}>
        <Stepper step={3} />
        <Confirmation appointment={booked} durationMin={info.durationMin} autoConfirm={info.autoConfirm} />
      </PortalShell>
    )
  }

  return (
    <PortalShell info={info}>
      <div className='mb-6'>
        <h1 className='text-2xl font-bold tracking-tight sm:text-3xl'>Reserva tu cita con {info.businessName}</h1>
        {info.welcome && <p className='mt-2 text-muted-foreground'>{info.welcome}</p>}
      </div>
      <Stepper step={step} />

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <CalendarClock className='size-5 text-primary' /> Elige día y hora
            </CardTitle>
            <CardDescription>
              Citas de {info.durationMin} minutos. Los días sin disponibilidad aparecen deshabilitados.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-5'>
            {slotError && (
              <Alert variant='destructive' role='alert'>
                <AlertDescription>{slotError}</AlertDescription>
              </Alert>
            )}
            <p className='rounded-md border bg-muted/40 px-3 py-2 text-sm'>
              ¿No encuentras una fecha que te convenga o necesitas atención urgente?{' '}
              <a href='/reservar/atencion' className='font-medium text-primary underline-offset-2 hover:underline'>
                Solicitar atención
              </a>
            </p>
            <SlotPicker
              cacheKey={['portal', 'availability']}
              fetchDays={(m) => portalApi.days(m)}
              fetchSlots={(d) => portalApi.slots(d)}
              value={slot}
              onChange={(v) => {
                setSlot(v)
                setSlotError(null)
              }}
              today={today}
            />
            <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
              <p className='text-sm text-muted-foreground'>
                {slot ? (
                  <>
                    Has elegido <strong className='text-foreground'>{formatLongDate(slot.date)} a las {slot.time}</strong>
                  </>
                ) : (
                  'Selecciona un horario para continuar.'
                )}
              </p>
              <Button size='lg' disabled={!slot} onClick={() => setStep(1)}>
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && slot && (
        <Card>
          <CardHeader>
            <CardTitle>Tus datos</CardTitle>
            <CardDescription>
              Reserva para el <strong className='text-foreground'>{formatLongDate(slot.date)} a las {slot.time}</strong>{' '}
              <button type='button' className='text-primary underline underline-offset-2' onClick={() => setStep(0)}>
                Cambiar
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => {
                  setFormError(null)
                  book.mutate(v)
                })}
                className='space-y-4'
                noValidate
              >
                <FormField
                  control={form.control}
                  name='fullName'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre y apellidos</FormLabel>
                      <FormControl>
                        <Input autoComplete='name' autoFocus {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='phone'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Teléfono</FormLabel>
                        <FormControl>
                          <Input type='tel' autoComplete='tel' placeholder='+34 600 000 000' {...field} />
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
                          <Input type='email' autoComplete='email' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name='reason'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Motivo de la visita</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder='Cuéntanos brevemente para qué vienes' {...field} />
                      </FormControl>
                      <FormDescription>Así podremos preparar mejor tu cita.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Campo trampa anti-bots: invisible para personas. */}
                <div aria-hidden className='absolute -start-[9999px] h-0 w-0 overflow-hidden'>
                  <label>
                    No rellenar
                    <input type='text' tabIndex={-1} autoComplete='off' {...form.register('website')} />
                  </label>
                </div>

                {formError && (
                  <Alert variant='destructive' role='alert'>
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}

                <p className='text-xs text-muted-foreground'>
                  Usaremos tus datos únicamente para gestionar esta cita y contactar contigo si es necesario.
                </p>

                <div className='flex items-center justify-between gap-3 pt-2'>
                  <Button type='button' variant='ghost' onClick={() => setStep(0)} disabled={book.isPending}>
                    <ArrowLeft /> Atrás
                  </Button>
                  <Button type='submit' size='lg' disabled={book.isPending}>
                    {book.isPending && <Loader2 className='animate-spin' />}
                    Reservar cita
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </PortalShell>
  )
}

function Confirmation({
  appointment: a,
  durationMin,
  autoConfirm,
}: {
  appointment: PublicAppointment
  durationMin: number
  autoConfirm: boolean
}) {
  const manageUrl = `${window.location.origin}/reservar/cita/${a.token}`
  const confirmed = a.status === 'confirmed'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manageUrl)
      toast.success('Enlace copiado.')
    } catch {
      toast.error('No se pudo copiar. Selecciónalo manualmente.')
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardContent className='space-y-6 pt-6'>
          <div className='flex flex-col items-center gap-3 text-center'>
            <div
              className={cn(
                'flex size-14 items-center justify-center rounded-full',
                confirmed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'
              )}
            >
              {confirmed ? <CheckCircle2 className='size-8' /> : <Clock3 className='size-8' />}
            </div>
            <div>
              <h1 className='text-2xl font-semibold tracking-tight'>
                {confirmed ? '¡Cita confirmada!' : '¡Solicitud recibida!'}
              </h1>
              <p className='mt-1 text-muted-foreground'>
                {confirmed || autoConfirm
                  ? 'Te esperamos. Guarda estos datos.'
                  : `${a.business.name} revisará tu reserva y la confirmará lo antes posible.`}
              </p>
            </div>
          </div>
          <div className='rounded-lg border bg-muted/30 p-4'>
            <AppointmentSummary appointment={a} />
          </div>
          <div className='flex flex-wrap justify-center gap-2'>
            <Button
              variant='outline'
              onClick={() =>
                downloadIcs(
                  'cita.ics',
                  buildIcs({
                    token: a.token,
                    startsAt: a.startsAt,
                    durationMin,
                    title: `Cita en ${a.business.name}`,
                    description: a.reason,
                    location: a.business.address,
                  })
                )
              }
            >
              <Download /> Añadir al calendario
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Tu enlace personal</CardTitle>
          <CardDescription>
            Guárdalo: con él puedes consultar, reprogramar o cancelar tu cita sin crear ninguna cuenta. No lo compartas.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-2 sm:flex-row'>
          <Input readOnly value={manageUrl} onFocus={(e) => e.currentTarget.select()} aria-label='Enlace para gestionar tu cita' />
          <Button variant='outline' onClick={copy}>
            <Copy /> Copiar
          </Button>
          <Button asChild>
            <Link to='/reservar/cita/$token' params={{ token: a.token }}>
              Ver mi cita
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
