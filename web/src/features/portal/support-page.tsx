import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { ArrowLeft, CheckCircle2, HeartHandshake, Loader2, Phone } from 'lucide-react'
import { z } from 'zod'
import { ApiError, errorMessage } from '@/api/client'
import { portalApi } from '@/api/services'
import type { SupportReason } from '@/types/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { PortalShell } from './portal-shell'
import { usePortalInfo } from './use-portal-info'

const REASONS: { value: SupportReason; label: string; hint: string }[] = [
  { value: 'no_date', label: 'No encuentro fecha', hint: 'Ninguno de los horarios disponibles me viene bien.' },
  { value: 'urgent', label: 'Necesito atención urgente', hint: 'Mi caso no puede esperar a una cita normal.' },
  { value: 'other', label: 'Otro motivo', hint: 'Tengo otra consulta.' },
]

const schema = z.object({
  fullName: z.string().trim().min(2, 'Indica tu nombre.').max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{7,25}$/, 'Teléfono no válido.')
    .refine((v) => v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15, 'Teléfono no válido.'),
  reason: z.enum(['no_date', 'urgent', 'other'], { error: 'Elige un motivo.' }),
  message: z.string().trim().max(300, 'Máximo 300 caracteres.'),
  consent: z.boolean().refine((v) => v, 'Debes aceptar que te contactemos para poder atender tu solicitud.'),
  website: z.string(),
})
type Values = z.infer<typeof schema>

/** Formulario público «Solicitar atención»: independiente de la reserva. Solo registra la solicitud. */
export function SupportRequestPage() {
  const { data: info, isLoading } = usePortalInfo()
  const [sent, setSent] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: '', reason: undefined as unknown as SupportReason, message: '', consent: false, website: '' },
  })
  const send = useMutation({
    mutationFn: (v: Values) =>
      portalApi.requestSupport({
        fullName: v.fullName,
        phone: v.phone,
        reason: v.reason,
        ...(v.message ? { message: v.message } : {}),
        consent: true,
        website: v.website,
      }),
    onSuccess: () => setSent(true),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400) {
        for (const [field, message] of Object.entries(e.fields)) form.setError(field as keyof Values, { message })
      }
    },
  })

  const phoneLine = info?.phone ? (
    <p className='flex items-center gap-2 text-sm'>
      <Phone className='size-4 text-muted-foreground' />
      Si es muy urgente, también puedes llamar al <strong>{info.phone}</strong>.
    </p>
  ) : null

  if (sent) {
    return (
      <PortalShell {...(info ? { info } : {})}>
        <Card className='mx-auto max-w-xl'>
          <CardContent className='space-y-4 p-8 text-center'>
            <CheckCircle2 className='mx-auto size-10 text-success' />
            <h1 className='text-xl font-bold'>Hemos recibido tu solicitud</h1>
            <p className='text-muted-foreground'>
              Tu solicitud ha quedado registrada para que la revise nuestro equipo. Esto <strong>no</strong> es una confirmación de
              contacto ni de cita: no se te ha enviado ningún mensaje y no podemos asegurar cuándo nos pondremos en contacto.
            </p>
            {phoneLine}
            <Button asChild variant='outline'>
              <a href='/reservar'>
                <ArrowLeft /> Volver a la reserva
              </a>
            </Button>
          </CardContent>
        </Card>
      </PortalShell>
    )
  }

  const errors = form.formState.errors
  const err = (name: keyof Values) =>
    errors[name]?.message ? (
      <p role='alert' className='text-xs text-destructive'>
        {String(errors[name]?.message)}
      </p>
    ) : null

  return (
    <PortalShell {...(info ? { info } : {})}>
      <div className='mx-auto max-w-xl'>
        <a href='/reservar' className='mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline'>
          <ArrowLeft className='size-4' /> Volver a la reserva
        </a>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <HeartHandshake className='size-5 text-primary' /> Solicitar atención
            </CardTitle>
            <CardDescription>
              Cuéntanos qué necesitas y nuestro equipo revisará tu solicitud. Es independiente de la reserva de citas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className='text-sm text-muted-foreground'>Cargando…</p>}
            <form onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate className='space-y-5'>
              {send.isError && !(send.error instanceof ApiError && send.error.status === 400) && (
                <Alert variant='destructive' role='alert'>
                  <AlertDescription>
                    {send.error instanceof ApiError && send.error.status === 429
                      ? 'Has enviado demasiadas solicitudes. Inténtalo de nuevo más tarde.'
                      : `No se pudo registrar tu solicitud: ${errorMessage(send.error)}`}
                  </AlertDescription>
                </Alert>
              )}

              <div className='space-y-2'>
                <Label>¿Qué necesitas?</Label>
                <Controller
                  control={form.control}
                  name='reason'
                  render={({ field }) => (
                    <RadioGroup value={field.value ?? ''} onValueChange={field.onChange}>
                      {REASONS.map((r) => (
                        <Label key={r.value} htmlFor={`reason-${r.value}`} className='flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal'>
                          <RadioGroupItem id={`reason-${r.value}`} value={r.value} className='mt-1' />
                          <span>
                            <span className='block font-medium'>{r.label}</span>
                            <span className='block text-xs text-muted-foreground'>{r.hint}</span>
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                />
                {err('reason')}
              </div>

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label htmlFor='sr-name'>Nombre</Label>
                  <Input id='sr-name' autoComplete='name' maxLength={100} {...form.register('fullName')} />
                  {err('fullName')}
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='sr-phone'>Teléfono de contacto</Label>
                  <Input id='sr-phone' type='tel' autoComplete='tel' placeholder='+34 600 000 000' {...form.register('phone')} />
                  {err('phone')}
                </div>
              </div>

              <div className='space-y-1.5'>
                <Label htmlFor='sr-message'>Mensaje (opcional)</Label>
                <Textarea id='sr-message' rows={3} maxLength={300} placeholder='Por ejemplo, qué días u horarios te irían bien.' {...form.register('message')} />
                {err('message')}
              </div>

              {/* Campo trampa anti-bots: invisible para las personas. */}
              <div aria-hidden className='absolute -start-[9999px] h-0 w-0 overflow-hidden'>
                <label>
                  Sitio web
                  <input tabIndex={-1} autoComplete='off' {...form.register('website')} />
                </label>
              </div>

              <div className='space-y-1.5'>
                <Controller
                  control={form.control}
                  name='consent'
                  render={({ field }) => (
                    <Label htmlFor='sr-consent' className='flex cursor-pointer items-start gap-3 font-normal'>
                      <Checkbox id='sr-consent' checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className='mt-0.5' />
                      <span className='text-sm'>
                        Acepto que el equipo use mi nombre y teléfono únicamente para contactarme sobre esta solicitud.
                      </span>
                    </Label>
                  )}
                />
                {err('consent')}
              </div>

              <Button type='submit' className='w-full' disabled={send.isPending}>
                {send.isPending && <Loader2 className='animate-spin' />}
                Enviar solicitud
              </Button>
              <p className='text-xs text-muted-foreground'>
                Solo registramos tu solicitud; no se envía ningún mensaje automático. Nuestro equipo te contactará, sin plazo garantizado.
              </p>
              {phoneLine}
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
