import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { appointmentsApi, availabilityApi } from '@/api/services'
import { formatLongDate, todayIn } from '@/lib/format'
import { applyServerErrors, appointmentSchema, type AppointmentValues } from '@/validation/forms'
import type { Appointment } from '@/types/api'
import { useTimezone } from '@/hooks/use-settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { SlotPicker, type SlotChoice } from '@/components/shared/slot-picker'
import { useInvalidateAppointments } from './use-appointment-actions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
} & (
  | {
      mode: 'create'
      prefill?: { date?: string; time?: string; customer?: Appointment['customer'] }
      onCreated?: (a: Appointment) => void
      appointment?: undefined
    }
  | { mode: 'edit'; appointment: Appointment; prefill?: undefined; onCreated?: undefined }
)

/** Alta de cita (con selector de horario) y edición de los datos de una cita existente. */
export function AppointmentFormDialog(props: Props) {
  const { open, onOpenChange, mode } = props
  const timezone = useTimezone()
  const invalidate = useInvalidateAppointments()
  const edit = props.mode === 'edit' ? props.appointment : undefined
  const prefill = props.mode === 'create' ? props.prefill : undefined

  const [slot, setSlot] = useState<SlotChoice | null>(
    prefill?.date && prefill.time ? { date: prefill.date, time: prefill.time } : null
  )
  const [slotError, setSlotError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<AppointmentValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      fullName: edit?.customer.fullName ?? prefill?.customer?.fullName ?? '',
      phone: edit?.customer.phone ?? prefill?.customer?.phone ?? '',
      email: edit?.customer.email ?? prefill?.customer?.email ?? '',
      reason: edit?.reason ?? '',
      internalNotes: edit?.internalNotes ?? '',
      status: 'confirmed',
    },
  })

  const save = useMutation({
    mutationFn: async (v: AppointmentValues) => {
      if (edit) {
        return appointmentsApi.update(edit.id, {
          fullName: v.fullName,
          phone: v.phone,
          email: v.email,
          reason: v.reason,
          internalNotes: v.internalNotes,
        })
      }
      return appointmentsApi.create({ ...v, date: slot!.date, time: slot!.time })
    },
    onSuccess: (appointment) => {
      toast.success(edit ? 'Cambios guardados.' : 'Cita creada.')
      invalidate()
      onOpenChange(false)
      if (props.mode === 'create') props.onCreated?.(appointment)
    },
    onError: (e) => {
      if (applyServerErrors(form, e)) return
      if (e instanceof ApiError && e.code === 'slot_unavailable') {
        setSlotError(e.message)
        setSlot(null)
        invalidate()
      } else setFormError(errorMessage(e))
    },
  })

  const submit = form.handleSubmit((v) => {
    setFormError(null)
    setSlotError(null)
    if (mode === 'create' && !slot) {
      setSlotError('Elige el día y la hora de la cita.')
      return
    }
    save.mutate(v)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{edit ? 'Editar cita' : 'Nueva cita'}</DialogTitle>
          <DialogDescription>
            {edit
              ? 'Actualiza los datos del cliente, el motivo o las notas internas.'
              : 'Elige un horario libre y registra los datos del cliente.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submit} className='space-y-5' noValidate>
            {mode === 'create' && (
              <section className='space-y-3'>
                <h3 className='text-sm font-medium'>1. Fecha y hora</h3>
                <SlotPicker
                  cacheKey={['availability', 'staff']}
                  fetchDays={(m) => availabilityApi.days(m)}
                  fetchSlots={(d) => availabilityApi.slots(d)}
                  value={slot}
                  onChange={(v) => {
                    setSlot(v)
                    setSlotError(null)
                  }}
                  today={todayIn(timezone)}
                />
                {slot && (
                  <p className='text-sm text-muted-foreground'>
                    Seleccionado: <strong className='text-foreground'>{formatLongDate(slot.date)}, {slot.time}</strong>
                  </p>
                )}
                {slotError && (
                  <Alert variant='destructive' role='alert'>
                    <AlertDescription>{slotError}</AlertDescription>
                  </Alert>
                )}
              </section>
            )}

            <section className='space-y-4'>
              {mode === 'create' && <h3 className='text-sm font-medium'>2. Datos de la cita</h3>}
              <div className='grid gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='fullName'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>Nombre completo</FormLabel>
                      <FormControl>
                        <Input autoComplete='off' {...field} />
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
                        <Input type='tel' placeholder='+34 600 000 000' {...field} />
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
                  name='reason'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>Motivo de la cita</FormLabel>
                      <FormControl>
                        <Input placeholder='Primera consulta, revisión…' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='internalNotes'
                  render={({ field }) => (
                    <FormItem className='sm:col-span-2'>
                      <FormLabel>Observaciones internas</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder='Solo las ve el equipo.' {...field} />
                      </FormControl>
                      <FormDescription>El cliente nunca ve estas notas.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {mode === 'create' && (
                  <FormField
                    control={form.control}
                    name='status'
                    render={({ field }) => (
                      <FormItem className='sm:col-span-2'>
                        <FormLabel>Estado inicial</FormLabel>
                        <FormControl>
                          <RadioGroup
                            value={field.value}
                            onValueChange={field.onChange}
                            className='flex gap-6'
                          >
                            <label className='flex items-center gap-2 text-sm'>
                              <RadioGroupItem value='confirmed' /> Confirmada
                            </label>
                            <label className='flex items-center gap-2 text-sm'>
                              <RadioGroupItem value='pending' /> Pendiente
                            </label>
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </section>

            {formError && (
              <Alert variant='destructive' role='alert'>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                {edit ? 'Guardar cambios' : 'Crear cita'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
