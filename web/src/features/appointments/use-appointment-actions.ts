import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { appointmentsApi } from '@/api/services'

/** Tras cualquier cambio en una cita se refrescan las vistas que la muestran. */
export function useInvalidateAppointments() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['appointments', 'calendar', 'dashboard', 'customers', 'availability', 'notifications', 'reports'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      )
    )
}

export function useAppointmentActions() {
  const invalidate = useInvalidateAppointments()
  const done = (message: string) => () => {
    toast.success(message)
    return invalidate()
  }
  const failed = (e: unknown) => toast.error(errorMessage(e))

  return {
    confirm: useMutation({
      mutationFn: (id: number) => appointmentsApi.confirm(id),
      onSuccess: done('Cita confirmada.'),
      onError: failed,
    }),
    complete: useMutation({
      mutationFn: (id: number) => appointmentsApi.complete(id),
      onSuccess: done('Cita marcada como completada.'),
      onError: failed,
    }),
    cancel: useMutation({
      mutationFn: (v: { id: number; reason: string }) => appointmentsApi.cancel(v.id, v.reason),
      onSuccess: done('Cita cancelada.'),
      onError: failed,
    }),
    reschedule: useMutation({
      mutationFn: (v: { id: number; date: string; time: string }) =>
        appointmentsApi.reschedule(v.id, v.date, v.time),
      onSuccess: done('Cita reprogramada.'),
      // El diálogo muestra el error de forma contextual (p. ej. horario ocupado).
    }),
  }
}
