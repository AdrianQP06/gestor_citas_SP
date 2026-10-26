import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { CalendarClock, CalendarX2, CheckCircle2, Clock3, FileQuestion, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { portalApi } from '@/api/services'
import { formatLongDate, todayIn } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/status'
import type { AppointmentStatus, Permission, PublicAppointment } from '@/types/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { SlotPicker, type SlotChoice } from '@/components/shared/slot-picker'
import { AppointmentSummary } from './appointment-summary'
import { PortalShell } from './portal-shell'
import { usePortalInfo } from './use-portal-info'

const STATUS_VIEW: Record<AppointmentStatus, { icon: React.ElementType; tone: string; text: string }> = {
  pending: {
    icon: Clock3,
    tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    text: 'Pendiente de confirmación',
  },
  confirmed: {
    icon: CheckCircle2,
    tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    text: 'Confirmada',
  },
  cancelled: { icon: XCircle, tone: 'bg-destructive/10 text-destructive', text: 'Cancelada' },
  completed: { icon: CheckCircle2, tone: 'bg-muted text-muted-foreground', text: STATUS_LABELS.completed },
}

export function ManagePage() {
  const { token } = useParams({ from: '/reservar/cita/$token' })
  const { data: info } = usePortalInfo()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [slot, setSlot] = useState<SlotChoice | null>(null)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [reason, setReason] = useState('')

  const { data: appt, isLoading, error } = useQuery({
    queryKey: ['portal', 'appointment', token],
    queryFn: () => portalApi.get(token),
    retry: false,
  })

  const update = (a: PublicAppointment) => {
    queryClient.setQueryData(['portal', 'appointment', token], a)
    queryClient.invalidateQueries({ queryKey: ['portal', 'availability'] })
  }

  const cancel = useMutation({
    mutationFn: () => portalApi.cancel(token, reason.trim()),
    onSuccess: (a) => {
      update(a)
      setConfirmCancel(false)
      toast.success('Tu cita ha sido cancelada.')
    },
    onError: (e) => {
      setConfirmCancel(false)
      toast.error(errorMessage(e))
      queryClient.invalidateQueries({ queryKey: ['portal', 'appointment', token] })
    },
  })

  const reschedule = useMutation({
    mutationFn: (s: SlotChoice) => portalApi.reschedule(token, s.date, s.time),
    onSuccess: (a) => {
      update(a)
      setMode('view')
      setSlot(null)
      toast.success('Tu cita se ha reprogramado.')
    },
    onError: (e) => {
      setRescheduleError(errorMessage(e))
      if (e instanceof ApiError && e.code === 'slot_unavailable') {
        setSlot(null)
        queryClient.invalidateQueries({ queryKey: ['portal', 'availability'] })
      }
    },
  })

  if (isLoading) {
    return (
      <PortalShell info={info}>
        <Skeleton className='h-80 w-full rounded-xl' />
      </PortalShell>
    )
  }
  if (error || !appt) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <PortalShell info={info}>
        <EmptyState
          icon={FileQuestion}
          title={notFound ? 'No encontramos esa cita' : 'No se pudo cargar tu cita'}
          description={
            notFound
              ? 'Revisa que hayas copiado el enlace completo. Si el problema continúa, contacta con el negocio.'
              : errorMessage(error)
          }
          action={
            <Button asChild>
              <Link to='/reservar'>Reservar una cita</Link>
            </Button>
          }
        />
      </PortalShell>
    )
  }

  const view = STATUS_VIEW[appt.status]
  const StatusIcon = view.icon
  const active = appt.status === 'pending' || appt.status === 'confirmed'
  const today = todayIn(appt.business.timezone)

  return (
    <PortalShell info={info}>
      <div className='space-y-6'>
        <Card>
          <CardHeader className='items-center text-center'>
            <div className={`flex size-14 items-center justify-center rounded-full ${view.tone}`}>
              <StatusIcon className='size-7' />
            </div>
            <CardTitle className='text-2xl'>{view.text}</CardTitle>
            <CardDescription>
              {appt.status === 'cancelled'
                ? appt.cancelledBy === 'client'
                  ? 'Has cancelado esta cita.'
                  : `${appt.business.name} ha cancelado esta cita. Contacta con ellos para más información.`
                : appt.status === 'pending'
                  ? 'Te avisaremos cuando el negocio la confirme.'
                  : 'Tu cita en ' + appt.business.name}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-5'>
            <div className='rounded-lg border bg-muted/30 p-4'>
              <AppointmentSummary appointment={appt} />
            </div>

            {mode === 'view' && active && (
              <div className='space-y-3'>
                <ActionRow
                  permission={appt.permissions.reschedule}
                  label='Reprogramar'
                  icon={<CalendarClock />}
                  onClick={() => {
                    setMode('reschedule')
                    setRescheduleError(null)
                  }}
                />
                <ActionRow
                  permission={appt.permissions.cancel}
                  label='Cancelar cita'
                  icon={<CalendarX2 />}
                  destructive
                  onClick={() => setConfirmCancel(true)}
                />
                {appt.business.phone && (
                  <p className='text-center text-sm text-muted-foreground'>
                    ¿Necesitas ayuda? Llama al{' '}
                    <a href={`tel:${appt.business.phone}`} className='font-medium text-foreground underline underline-offset-2'>
                      {appt.business.phone}
                    </a>
                  </p>
                )}
              </div>
            )}

            {!active && (
              <div className='flex justify-center'>
                <Button asChild>
                  <Link to='/reservar'>Reservar otra cita</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {mode === 'reschedule' && (
          <Card>
            <CardHeader>
              <CardTitle>Elige el nuevo horario</CardTitle>
              <CardDescription>Tu horario actual se liberará al confirmar el cambio.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-5'>
              {rescheduleError && (
                <Alert variant='destructive' role='alert'>
                  <AlertDescription>{rescheduleError}</AlertDescription>
                </Alert>
              )}
              <SlotPicker
                cacheKey={['portal', 'availability', token]}
                fetchDays={(m) => portalApi.days(m, token)}
                fetchSlots={(d) => portalApi.slots(d, token)}
                value={slot}
                onChange={(v) => {
                  setSlot(v)
                  setRescheduleError(null)
                }}
                today={today}
              />
              <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
                <p className='text-sm text-muted-foreground'>
                  {slot ? (
                    <>
                      Nuevo horario:{' '}
                      <strong className='text-foreground'>{formatLongDate(slot.date)} a las {slot.time}</strong>
                    </>
                  ) : (
                    'Selecciona un horario.'
                  )}
                </p>
                <div className='flex gap-2'>
                  <Button variant='outline' onClick={() => setMode('view')} disabled={reschedule.isPending}>
                    Volver
                  </Button>
                  <Button disabled={!slot || reschedule.isPending} onClick={() => slot && reschedule.mutate(slot)}>
                    {reschedule.isPending && <Loader2 className='animate-spin' />}
                    Confirmar cambio
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title='¿Cancelar tu cita?'
        desc={`Se cancelará la cita del ${formatLongDate(appt.date)} a las ${appt.time}. Esta acción no se puede deshacer, pero podrás reservar de nuevo.`}
        confirmText='Sí, cancelar cita'
        cancelBtnText='No, mantenerla'
        destructive
        isLoading={cancel.isPending}
        handleConfirm={() => cancel.mutate()}
      >
        <div className='space-y-2'>
          <Label htmlFor='client-cancel-reason'>¿Nos cuentas el motivo? (opcional)</Label>
          <Textarea id='client-cancel-reason' rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </PortalShell>
  )
}

function ActionRow({
  permission,
  label,
  icon,
  onClick,
  destructive,
}: {
  permission: Permission
  label: string
  icon: React.ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  if (permission.allowed) {
    return (
      <Button
        variant={destructive ? 'outline' : 'default'}
        className={destructive ? 'w-full text-destructive hover:text-destructive' : 'w-full'}
        size='lg'
        onClick={onClick}
      >
        {icon} {label}
      </Button>
    )
  }
  return (
    <div className='rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>
      <p className='font-medium text-foreground'>{label} no disponible</p>
      <p>{permission.reason}</p>
    </div>
  )
}
