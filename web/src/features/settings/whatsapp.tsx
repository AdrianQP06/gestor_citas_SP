import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { whatsappApi } from '@/api/services'
import { formatDateTime } from '@/lib/format'
import { NOTIFICATION_LABELS } from '@/lib/status'
import {
  applyServerErrors,
  recipientSchema,
  reminderSettingsSchema,
  type ReminderSettingsValues,
} from '@/validation/forms'
import type { NotificationStatus, Recipient } from '@/types/api'
import { useIsAdmin } from '@/hooks/use-session'
import { useSettings, useTimezone } from '@/hooks/use-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { NotificationBadge } from '@/components/shared/status-badge'
import { z } from 'zod'
import { AdminOnlyNotice, NumberField, SettingsSection } from './components'
import { useSaveSettings } from './use-save-settings'

export function WhatsAppSettings() {
  const isAdmin = useIsAdmin()
  return (
    <div className='space-y-6'>
      {!isAdmin && <AdminOnlyNotice />}
      <StatusCard />
      <ReminderTimingCard isAdmin={isAdmin} />
      <RecipientsCard isAdmin={isAdmin} />
      <LogCard />
    </div>
  )
}

function StatusCard() {
  const { data } = useSettings()
  const wa = data?.whatsapp
  if (!wa) return <Skeleton className='h-28 w-full' />

  if (wa.testMode) {
    return (
      <Alert>
        <FlaskConical />
        <AlertTitle>Modo de prueba activo (WHATSAPP_PROVIDER=test)</AlertTitle>
        <AlertDescription>
          <p>
            Los recordatorios se programan y se registran, pero <strong>no se envía ningún mensaje real</strong>. Para
            enviarlos por la API oficial de WhatsApp Business (Meta) configura <code>WHATSAPP_PROVIDER=meta</code>, el
            token, el identificador del número y la plantilla aprobada en las variables de entorno del servidor. Los
            pasos están en el README (sección «WhatsApp»).
          </p>
        </AlertDescription>
      </Alert>
    )
  }
  if (!wa.configured) {
    return (
      <Alert variant='destructive'>
        <AlertTriangle />
        <AlertTitle>Faltan credenciales de WhatsApp</AlertTitle>
        <AlertDescription>
          Define <code>WHATSAPP_TOKEN</code> y <code>WHATSAPP_PHONE_NUMBER_ID</code> en el servidor. Mientras tanto los
          recordatorios esperan en cola y caducan al comenzar la cita.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <CheckCircle2 className='text-emerald-600' />
      <AlertTitle>WhatsApp Business (API oficial) conectado</AlertTitle>
      <AlertDescription>
        Los envíos usan la plantilla <code>{wa.templateName}</code>. Usa «Enviar prueba» en un destinatario para
        verificar que llega.
      </AlertDescription>
    </Alert>
  )
}

function ReminderTimingCard({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useSettings()
  const form = useForm<ReminderSettingsValues>({
    resolver: zodResolver(reminderSettingsSchema),
    defaultValues: { reminder_minutes: 20 },
  })
  const save = useSaveSettings(data?.settings, (e) => applyServerErrors(form, e))
  useEffect(() => {
    if (data) form.reset({ reminder_minutes: data.settings.reminder_minutes })
  }, [data, form])

  return (
    <SettingsSection
      title='Recordatorio al equipo'
      description='Se envía un mensaje a los números de abajo antes de cada cita pendiente o confirmada, con el nombre del cliente, la hora y el motivo.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='flex flex-wrap items-end gap-3' noValidate>
          <fieldset disabled={!isAdmin || save.isPending} className='flex flex-wrap items-end gap-3'>
            <NumberField control={form.control} name='reminder_minutes' label='Avisar con' suffix='minutos de antelación' min={1} max={1440} />
            {isAdmin && (
              <Button type='submit' variant='outline' disabled={!form.formState.isDirty || save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                Guardar
              </Button>
            )}
          </fieldset>
        </form>
      </Form>
    </SettingsSection>
  )
}

const recipientFormSchema = recipientSchema.extend({ phone: z.string().trim().min(1, 'Indica el teléfono.') })
type RecipientValues = z.infer<typeof recipientFormSchema>

function RecipientsCard({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'recipients'], queryFn: whatsappApi.recipients })
  const [editing, setEditing] = useState<Recipient | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<Recipient | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['settings', 'recipients'] })
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const toggle = useMutation({
    mutationFn: (r: Recipient) => whatsappApi.updateRecipient(r.id, { name: r.name, phone: r.phone, active: !r.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (r: Recipient) => whatsappApi.deleteRecipient(r.id),
    onSuccess: () => {
      toast.success('Destinatario eliminado.')
      refresh()
      setToDelete(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const test = useMutation({
    mutationFn: (r: Recipient) => whatsappApi.test(r.id),
    onSuccess: (res) =>
      res.provider === 'test'
        ? toast.info('Modo de prueba: no se ha enviado ningún mensaje real.', { description: 'Solo se ha registrado en el log del servidor.' })
        : toast.success('Mensaje de prueba enviado. Revisa el WhatsApp del destinatario.'),
    onError: (e) => toast.error(errorMessage(e), { duration: 10_000 }),
  })

  return (
    <SettingsSection
      title='Números que reciben el aviso'
      description='Teléfonos del equipo en formato internacional (+34…). Pueden ser varios.'
      footer={
        isAdmin && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Añadir número
          </Button>
        )
      }
    >
      {isLoading && <Skeleton className='h-20 w-full' />}
      {data?.recipients.length === 0 && (
        <EmptyState
          icon={Send}
          title='Aún no hay destinatarios'
          description='Sin números no se enviará ningún recordatorio. Añade al menos uno.'
          className='py-6'
        />
      )}
      {!!data?.recipients.length && (
        <ul className='divide-y rounded-lg border'>
          {data.recipients.map((r) => (
            <li key={r.id} className='flex flex-wrap items-center gap-3 p-3'>
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>{r.name}</p>
                <p className='text-sm text-muted-foreground tabular-nums'>{r.phone}</p>
              </div>
              {isAdmin ? (
                <>
                  <label className='flex items-center gap-2 text-sm text-muted-foreground'>
                    <Switch checked={r.active} onCheckedChange={() => toggle.mutate(r)} aria-label={`Activar avisos para ${r.name}`} />
                    {r.active ? 'Activo' : 'Pausado'}
                  </label>
                  <Button variant='outline' size='sm' onClick={() => test.mutate(r)} disabled={test.isPending && test.variables?.id === r.id}>
                    {test.isPending && test.variables?.id === r.id ? <Loader2 className='animate-spin' /> : <Send />}
                    Enviar prueba
                  </Button>
                  <Button variant='ghost' size='icon' onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                    <Pencil className='size-4' />
                  </Button>
                  <Button variant='ghost' size='icon' onClick={() => setToDelete(r)} aria-label={`Eliminar ${r.name}`}>
                    <Trash2 className='size-4' />
                  </Button>
                </>
              ) : (
                <span className='text-sm text-muted-foreground'>{r.active ? 'Activo' : 'Pausado'}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <RecipientDialog recipient={editing === 'new' ? null : editing} onOpenChange={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title='Eliminar destinatario'
        desc={toDelete ? `${toDelete.name} dejará de recibir recordatorios.` : ''}
        confirmText='Eliminar'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </SettingsSection>
  )
}

function RecipientDialog({
  recipient,
  onOpenChange,
  onSaved,
}: {
  recipient: Recipient | null
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const form = useForm<RecipientValues>({
    resolver: zodResolver(recipientFormSchema),
    defaultValues: { name: recipient?.name ?? '', phone: recipient?.phone ?? '', active: recipient?.active ?? true },
  })
  const save = useMutation({
    mutationFn: (v: RecipientValues) => {
      // El formulario valida el formato; aquí se normaliza igual que lo hará el servidor.
      const parsed = recipientSchema.parse(v)
      return recipient ? whatsappApi.updateRecipient(recipient.id, parsed) : whatsappApi.addRecipient(parsed)
    },
    onSuccess: () => {
      toast.success(recipient ? 'Destinatario actualizado.' : 'Destinatario añadido.')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => {
      if (!applyServerErrors(form, e)) toast.error(errorMessage(e))
    },
  })

  return (
    <Dialog open onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{recipient ? 'Editar destinatario' : 'Nuevo destinatario'}</DialogTitle>
          <DialogDescription>El número debe tener WhatsApp y estar en formato internacional.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => {
              const r = recipientSchema.safeParse(v)
              if (!r.success) {
                for (const issue of r.error.issues) form.setError(issue.path[0] as keyof RecipientValues, { message: issue.message })
                return
              }
              save.mutate(v)
            })}
            className='space-y-4'
            noValidate
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder='Recepción' {...field} />
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
                  <FormLabel>Teléfono de WhatsApp</FormLabel>
                  <FormControl>
                    <Input type='tel' placeholder='+34 600 000 000' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={save.isPending}>
                Cancelar
              </Button>
              <Button type='submit' disabled={save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function LogCard() {
  const timezone = useTimezone()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'all' | NotificationStatus>('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['notifications', status, page],
    queryFn: () => whatsappApi.notifications(status === 'all' ? undefined : status, page),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const retry = useMutation({
    mutationFn: (id: number) => whatsappApi.retry(id),
    onSuccess: () => {
      toast.success('Reintento programado.')
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 15))

  return (
    <SettingsSection
      title='Registro de recordatorios'
      description='Cada envío queda registrado con su resultado. Los fallidos se pueden reintentar mientras la cita no haya empezado.'
      footer={undefined}
    >
      <div className='flex items-center gap-2'>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status)
            setPage(1)
          }}
        >
          <SelectTrigger className='w-44' aria-label='Filtrar por estado'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Todos</SelectItem>
            {(Object.keys(NOTIFICATION_LABELS) as NotificationStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {NOTIFICATION_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFetching && <Loader2 className='size-4 animate-spin text-muted-foreground' />}
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40 hover:bg-muted/40'>
              <TableHead>Cita</TableHead>
              <TableHead className='hidden md:table-cell'>Destinatario</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className='hidden lg:table-cell'>Programado</TableHead>
              <TableHead className='w-12' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className='h-8 w-full' />
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((n) => (
              <TableRow key={n.id}>
                <TableCell>
                  <div className='font-medium'>{n.clientName}</div>
                  <div className='text-xs text-muted-foreground tabular-nums'>
                    {n.appointmentDate} · {n.appointmentTime}
                  </div>
                </TableCell>
                <TableCell className='hidden md:table-cell'>
                  <div>{n.recipientName}</div>
                  <div className='text-xs text-muted-foreground tabular-nums'>{n.recipientPhone}</div>
                </TableCell>
                <TableCell>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <NotificationBadge status={n.status} />
                    {n.provider === 'test' && n.status === 'sent' && (
                      <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase'>
                        Prueba
                      </span>
                    )}
                  </div>
                  {n.lastError && (
                    <p className='mt-1 max-w-64 text-xs text-destructive' title={n.lastError}>
                      {n.lastError}
                    </p>
                  )}
                </TableCell>
                <TableCell className='hidden text-sm text-muted-foreground lg:table-cell'>
                  {formatDateTime(n.scheduledFor, timezone)}
                  {n.attempts > 0 && <div className='text-xs'>{n.attempts} intento{n.attempts > 1 ? 's' : ''}</div>}
                </TableCell>
                <TableCell>
                  {(n.status === 'failed' || n.status === 'expired') && (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => retry.mutate(n.id)}
                      disabled={retry.isPending}
                      aria-label='Reintentar envío'
                      title='Reintentar'
                    >
                      <RefreshCw className='size-4' />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data?.items.length === 0 && (
          <EmptyState
            icon={Send}
            title='Sin recordatorios'
            description='Aparecerán aquí cuando haya citas próximas y destinatarios activos.'
            className='py-8'
          />
        )}
      </div>

      {(data?.total ?? 0) > 15 && (
        <div className='flex items-center justify-end gap-2 text-sm text-muted-foreground'>
          <Button variant='outline' size='icon' disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label='Anterior'>
            <ChevronLeft />
          </Button>
          <span className='tabular-nums'>
            {page} / {pages}
          </span>
          <Button variant='outline' size='icon' disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label='Siguiente'>
            <ChevronRight />
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
