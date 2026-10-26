import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  CalendarX2,
  Check,
  CheckCheck,
  Copy,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { appointmentsApi } from '@/api/services'
import { formatDateTime, formatLongDate } from '@/lib/format'
import type { Appointment } from '@/types/api'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/shared/status-badge'
import { OperationsSection } from '@/features/operations/operations-section'
import { AppointmentFormDialog } from './appointment-form-dialog'
import { CancelDialog } from './cancel-dialog'
import { RescheduleDialog } from './reschedule-dialog'
import { useAppointmentActions, useInvalidateAppointments } from './use-appointment-actions'

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className='flex gap-3'>
      <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      <div className='min-w-0'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        <div className='text-sm break-words'>{children}</div>
      </div>
    </div>
  )
}

function NotesEditor({ appointment }: { appointment: Appointment }) {
  const invalidate = useInvalidateAppointments()
  const [notes, setNotes] = useState(appointment.internalNotes)
  const save = useMutation({
    mutationFn: () => appointmentsApi.update(appointment.id, { internalNotes: notes }),
    onSuccess: () => {
      toast.success('Observaciones guardadas.')
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className='space-y-2'>
      <Label htmlFor='internal-notes'>Observaciones internas</Label>
      <Textarea
        id='internal-notes'
        rows={4}
        maxLength={1000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder='Notas visibles solo para el equipo.'
      />
      <div className='flex justify-end'>
        <Button
          size='sm'
          variant='outline'
          disabled={notes === appointment.internalNotes || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending && <Loader2 className='animate-spin' />}
          Guardar notas
        </Button>
      </div>
    </div>
  )
}

const digits = (phone: string) => phone.replace(/\D/g, '')

type Props = { id: number | null; onClose: () => void }

/** Panel lateral con el detalle de una cita y todas las acciones de gestión. */
export function AppointmentSheet({ id, onClose }: Props) {
  const timezone = useTimezone()
  const actions = useAppointmentActions()
  const [editing, setEditing] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const { data: appt, isLoading, error } = useQuery({
    queryKey: ['appointments', 'detail', id],
    queryFn: () => appointmentsApi.get(id!),
    enabled: id !== null,
  })

  const active = appt && (appt.status === 'pending' || appt.status === 'confirmed')
  const started = appt ? new Date(appt.startsAt) <= new Date() : false
  const manageUrl = appt ? `${window.location.origin}/reservar/cita/${appt.publicToken}` : ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(manageUrl)
      toast.success('Enlace copiado.')
    } catch {
      toast.error('No se pudo copiar. Selecciónalo manualmente.')
    }
  }

  return (
    <>
      <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className='flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md'>
          {isLoading && (
            <div className='space-y-4 p-6'>
              <Skeleton className='h-6 w-2/3' />
              <Skeleton className='h-4 w-1/2' />
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-24 w-full' />
            </div>
          )}
          {error && (
            <div className='p-6 text-sm text-destructive'>
              {error instanceof ApiError && error.status === 404
                ? 'Esta cita ya no existe.'
                : errorMessage(error)}
            </div>
          )}
          {appt && (
            <>
              <SheetHeader className='space-y-2 border-b p-6 text-start'>
                <div className='flex items-center justify-between gap-2 pe-6'>
                  <SheetTitle className='truncate'>{appt.customer.fullName}</SheetTitle>
                  <StatusBadge status={appt.status} />
                </div>
                <SheetDescription>
                  {formatLongDate(appt.date)} · {appt.time} – {appt.endTime}
                </SheetDescription>
              </SheetHeader>

              <div className='flex-1 space-y-5 p-6'>
                <div className='grid gap-4'>
                  <InfoRow icon={CalendarClock} label='Motivo'>
                    {appt.reason}
                  </InfoRow>
                  <InfoRow icon={Phone} label='Teléfono'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                      <a href={`tel:${appt.customer.phone}`} className='hover:underline'>
                        {appt.customer.phone}
                      </a>
                      <a
                        href={`https://wa.me/${digits(appt.customer.phone)}`}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex items-center gap-1 text-xs text-primary hover:underline'
                      >
                        <MessageCircle className='size-3.5' /> WhatsApp
                      </a>
                    </div>
                  </InfoRow>
                  <InfoRow icon={Mail} label='Correo electrónico'>
                    <a href={`mailto:${appt.customer.email}`} className='hover:underline'>
                      {appt.customer.email}
                    </a>
                  </InfoRow>
                  <InfoRow icon={Globe} label='Origen'>
                    {appt.source === 'portal' ? 'Portal de reservas' : 'Creada por el equipo'} ·{' '}
                    {formatDateTime(appt.createdAt, timezone)}
                  </InfoRow>
                  <InfoRow icon={User} label='Cliente'>
                    <Link
                      to='/customers/$customerId'
                      params={{ customerId: String(appt.customer.id) }}
                      className='text-primary hover:underline'
                      onClick={onClose}
                    >
                      Ver ficha e historial
                    </Link>
                  </InfoRow>
                  {appt.status === 'cancelled' && (
                    <InfoRow icon={CalendarX2} label='Cancelación'>
                      Cancelada por {appt.cancelledBy === 'client' ? 'el cliente' : 'el equipo'}
                      {appt.cancelReason ? `: ${appt.cancelReason}` : '.'}
                    </InfoRow>
                  )}
                </div>

                <Separator />

                <NotesEditor key={`${appt.id}:${appt.internalNotes}`} appointment={appt} />

                <Separator />

                <OperationsSection appointmentId={appt.id} />

                <Separator />

                <div className='space-y-2'>
                  <Label>Enlace de gestión del cliente</Label>
                  <p className='text-xs text-muted-foreground'>
                    El cliente puede consultar, reprogramar o cancelar su cita desde este enlace (según tus reglas).
                  </p>
                  <Button variant='outline' size='sm' onClick={copyLink} className='w-full justify-start'>
                    <Copy /> Copiar enlace
                  </Button>
                </div>
              </div>

              <SheetFooter className='flex-col gap-2 border-t bg-muted/30 p-4 sm:flex-col'>
                {appt.status === 'pending' && (
                  <Button onClick={() => actions.confirm.mutate(appt.id)} disabled={actions.confirm.isPending}>
                    {actions.confirm.isPending ? <Loader2 className='animate-spin' /> : <Check />}
                    Confirmar cita
                  </Button>
                )}
                {active && started && (
                  <Button variant='secondary' onClick={() => actions.complete.mutate(appt.id)} disabled={actions.complete.isPending}>
                    <CheckCheck /> Marcar como completada
                  </Button>
                )}
                <div className='grid grid-cols-2 gap-2'>
                  <Button variant='outline' onClick={() => setEditing(true)}>
                    <Pencil /> Editar datos
                  </Button>
                  {active ? (
                    <Button variant='outline' onClick={() => setRescheduling(true)}>
                      <CalendarClock /> Reprogramar
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
                {active && (
                  <Button variant='ghost' className='text-destructive hover:text-destructive' onClick={() => setCancelling(true)}>
                    <CalendarX2 /> Cancelar cita
                  </Button>
                )}
              </SheetFooter>

              {editing && (
                <AppointmentFormDialog mode='edit' appointment={appt} open onOpenChange={setEditing} />
              )}
              {rescheduling && <RescheduleDialog appointment={appt} open onOpenChange={setRescheduling} />}
              {cancelling && <CancelDialog appointment={appt} open onOpenChange={setCancelling} />}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
