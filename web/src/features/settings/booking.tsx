import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { applyServerErrors, bookingSettingsSchema, type BookingSettingsValues } from '@/validation/forms'
import { useIsAdmin } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminOnlyNotice, NumberField, SettingsSection, SwitchField } from './components'
import { useSaveSettings } from './use-save-settings'

const pick = (s: BookingSettingsValues): BookingSettingsValues => ({
  appointment_duration_min: s.appointment_duration_min,
  buffer_min: s.buffer_min,
  min_notice_min: s.min_notice_min,
  max_advance_days: s.max_advance_days,
  auto_confirm: s.auto_confirm,
  allow_client_cancel: s.allow_client_cancel,
  allow_client_reschedule: s.allow_client_reschedule,
  client_change_notice_hours: s.client_change_notice_hours,
})

export function BookingSettings() {
  const { data, isLoading } = useSettings()
  const isAdmin = useIsAdmin()
  const form = useForm<BookingSettingsValues>({
    resolver: zodResolver(bookingSettingsSchema),
    defaultValues: {
      appointment_duration_min: 30,
      buffer_min: 0,
      min_notice_min: 120,
      max_advance_days: 60,
      auto_confirm: false,
      allow_client_cancel: true,
      allow_client_reschedule: true,
      client_change_notice_hours: 24,
    },
  })
  const save = useSaveSettings(data?.settings, (e) => applyServerErrors(form, e))
  const cancelAllowed = useWatch({ control: form.control, name: 'allow_client_cancel' })
  const rescheduleAllowed = useWatch({ control: form.control, name: 'allow_client_reschedule' })

  useEffect(() => {
    if (data) form.reset(pick(data.settings))
  }, [data, form])

  if (isLoading || !data) return <Skeleton className='h-96 w-full' />

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-6' noValidate>
        {!isAdmin && <AdminOnlyNotice />}
        <fieldset disabled={!isAdmin || save.isPending} className='space-y-6'>
          <SettingsSection
            title='Duración y huecos'
            description='Los horarios disponibles se calculan con estos valores: apertura + k × (duración + intervalo).'
          >
            <div className='grid gap-4 sm:grid-cols-2'>
              <NumberField control={form.control} name='appointment_duration_min' label='Duración de cada cita' suffix='min' min={5} max={480} />
              <NumberField
                control={form.control}
                name='buffer_min'
                label='Intervalo entre citas'
                suffix='min'
                min={0}
                max={120}
                description='Tiempo libre tras cada cita (limpieza, preparación…).'
              />
            </div>
          </SettingsSection>

          <SettingsSection title='Plazos de reserva' description='Cuándo pueden reservar los clientes desde el portal.'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <NumberField
                control={form.control}
                name='min_notice_min'
                label='Antelación mínima para reservar'
                suffix='min'
                min={0}
                description='120 = hasta 2 horas antes de la cita. El equipo no tiene esta limitación.'
              />
              <NumberField
                control={form.control}
                name='max_advance_days'
                label='Reservas con hasta'
                suffix='días de antelación'
                min={1}
                max={365}
              />
            </div>
            <SwitchField
              control={form.control}
              name='auto_confirm'
              label='Confirmar automáticamente las reservas del portal'
              description='Si está desactivado, las reservas quedan "pendientes" hasta que las confirmes.'
            />
          </SettingsSection>

          <SettingsSection
            title='Cambios por parte del cliente'
            description='Qué puede hacer el cliente desde su enlace seguro, sin cuenta.'
          >
            <SwitchField control={form.control} name='allow_client_cancel' label='Permitir cancelar' />
            <SwitchField
              control={form.control}
              name='allow_client_reschedule'
              label='Permitir reprogramar'
              description='Al reprogramar, una cita confirmada vuelve a "pendiente" salvo que confirmes automáticamente.'
            />
            <NumberField
              control={form.control}
              name='client_change_notice_hours'
              label='Plazo para cancelar o reprogramar'
              suffix='horas antes de la cita'
              min={0}
              max={336}
              description={
                cancelAllowed || rescheduleAllowed
                  ? 'Pasado este plazo, el cliente deberá contactar contigo.'
                  : 'No aplica mientras ambas opciones estén desactivadas.'
              }
            />
          </SettingsSection>
        </fieldset>
        {isAdmin && (
          <div className='flex justify-end'>
            <Button type='submit' disabled={!form.formState.isDirty || save.isPending}>
              {save.isPending && <Loader2 className='animate-spin' />}
              Guardar cambios
            </Button>
          </div>
        )}
      </form>
    </Form>
  )
}
