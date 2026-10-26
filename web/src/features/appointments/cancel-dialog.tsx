import { useState } from 'react'
import type { Appointment } from '@/types/api'
import { formatMediumDate } from '@/lib/format'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAppointmentActions } from './use-appointment-actions'

type Props = {
  appointment: Appointment
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CancelDialog({ appointment, open, onOpenChange }: Props) {
  const { cancel } = useAppointmentActions()
  const [reason, setReason] = useState('')

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Cancelar cita'
      desc={`Se cancelará la cita de ${appointment.customer.fullName} del ${formatMediumDate(appointment.date)} a las ${appointment.time}. El horario quedará libre.`}
      confirmText='Cancelar cita'
      cancelBtnText='Mantener cita'
      destructive
      isLoading={cancel.isPending}
      handleConfirm={() =>
        cancel.mutate(
          { id: appointment.id, reason: reason.trim() },
          { onSuccess: () => onOpenChange(false) }
        )
      }
    >
      <div className='space-y-2'>
        <Label htmlFor='cancel-reason'>Motivo (opcional, solo interno)</Label>
        <Textarea
          id='cancel-reason'
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder='Ej.: el cliente avisó por teléfono'
        />
      </div>
    </ConfirmDialog>
  )
}
