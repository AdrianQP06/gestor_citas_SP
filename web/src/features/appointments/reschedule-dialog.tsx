import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ApiError, errorMessage } from '@/api/client'
import { availabilityApi } from '@/api/services'
import { formatLongDate, todayIn } from '@/lib/format'
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
import { SlotPicker, type SlotChoice } from '@/components/shared/slot-picker'
import { useAppointmentActions } from './use-appointment-actions'

type Props = {
  appointment: Appointment
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RescheduleDialog({ appointment, open, onOpenChange }: Props) {
  const timezone = useTimezone()
  const { reschedule } = useAppointmentActions()
  const [slot, setSlot] = useState<SlotChoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!slot) return
    setError(null)
    reschedule.mutate(
      { id: appointment.id, ...slot },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => {
          setError(errorMessage(e))
          if (e instanceof ApiError && e.code === 'slot_unavailable') setSlot(null)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !reschedule.isPending && onOpenChange(o)}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Reprogramar cita</DialogTitle>
          <DialogDescription>
            {appointment.customer.fullName} · actualmente el {formatLongDate(appointment.date)} a las{' '}
            {appointment.time}.
          </DialogDescription>
        </DialogHeader>

        <SlotPicker
          cacheKey={['availability', 'staff', appointment.id]}
          fetchDays={(m) => availabilityApi.days(m, appointment.id)}
          fetchSlots={(d) => availabilityApi.slots(d, appointment.id)}
          value={slot}
          onChange={(v) => {
            setSlot(v)
            setError(null)
          }}
          today={todayIn(timezone)}
        />

        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className='items-center sm:justify-between'>
          <p className='text-sm text-muted-foreground'>
            {slot ? (
              <>
                Nuevo horario: <strong className='text-foreground'>{formatLongDate(slot.date)}, {slot.time}</strong>
              </>
            ) : (
              'Elige un nuevo horario.'
            )}
          </p>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)} disabled={reschedule.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!slot || reschedule.isPending}>
              {reschedule.isPending && <Loader2 className='animate-spin' />}
              Reprogramar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
