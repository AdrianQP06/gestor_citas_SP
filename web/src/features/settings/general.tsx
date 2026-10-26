import { useEffect, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { applyServerErrors, generalSettingsSchema, type GeneralSettingsValues } from '@/validation/forms'
import { useIsAdmin } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AdminOnlyNotice, SettingsSection, SwitchField } from './components'
import { useSaveSettings } from './use-save-settings'

const FALLBACK_ZONES = ['Europe/Madrid', 'Europe/Lisbon', 'Atlantic/Canary', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires']

function timezones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : FALLBACK_ZONES
  return all.includes(current) ? all : [current, ...all]
}

export function GeneralSettings() {
  const { data, isLoading } = useSettings()
  const isAdmin = useIsAdmin()
  const form = useForm<GeneralSettingsValues>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      business_name: '',
      timezone: '',
      address: '',
      contact_phone: '',
      portal_welcome: '',
      portal_enabled: true,
    },
  })
  const save = useSaveSettings(data?.settings, (e) => applyServerErrors(form, e))

  useEffect(() => {
    if (data) form.reset(pick(data.settings))
  }, [data, form])

  const zones = useMemo(() => timezones(data?.settings.timezone ?? 'Europe/Madrid'), [data])

  if (isLoading || !data) return <Skeleton className='h-96 w-full' />

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-6' noValidate>
        {!isAdmin && <AdminOnlyNotice />}
        <fieldset disabled={!isAdmin || save.isPending} className='space-y-6'>
          <SettingsSection
            title='Datos del negocio'
            description='Se muestran a tus clientes en el portal de reservas.'
          >
            <FormField
              control={form.control}
              name='business_name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del negocio</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='address'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dirección</FormLabel>
                    <FormControl>
                      <Input placeholder='Calle, número, ciudad' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='contact_phone'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono de contacto</FormLabel>
                    <FormControl>
                      <Input type='tel' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='timezone'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zona horaria</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className='flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50'
                    >
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    Todos los horarios, citas y recordatorios se interpretan en esta zona.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection title='Portal de reservas' description='La página pública donde tus clientes piden cita.'>
            <SwitchField
              control={form.control}
              name='portal_enabled'
              label='Aceptar reservas online'
              description='Si lo desactivas, el enlace público mostrará que no hay reservas disponibles.'
            />
            <FormField
              control={form.control}
              name='portal_welcome'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mensaje de bienvenida</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
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

const pick = (s: GeneralSettingsValues): GeneralSettingsValues => ({
  business_name: s.business_name,
  timezone: s.timezone,
  address: s.address,
  contact_phone: s.contact_phone,
  portal_welcome: s.portal_welcome,
  portal_enabled: s.portal_enabled,
})
