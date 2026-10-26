import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarOff, Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { settingsApi } from '@/api/services'
import { formatMediumDate, todayIn } from '@/lib/format'
import {
  applyServerErrors,
  blockSchema,
  exceptionSchema,
  type BlockValues,
  type ExceptionValues,
} from '@/validation/forms'
import { useIsAdmin } from '@/hooks/use-session'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { AdminOnlyNotice, SettingsSection, SwitchField } from './components'

function useRefreshAvailability() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of ['settings', 'availability', 'calendar'])
      queryClient.invalidateQueries({ queryKey: [key] })
  }
}

const warnAffected = (n: number) =>
  n > 0 &&
  toast.warning(`Hay ${n} cita${n > 1 ? 's' : ''} en ese tramo.`, {
    description: 'No se cancelan automáticamente: revísalas en el calendario y reprográmalas o cancélalas.',
    duration: 10_000,
  })

export function ExceptionsSettings() {
  const isAdmin = useIsAdmin()
  return (
    <div className='space-y-6'>
      {!isAdmin && <AdminOnlyNotice />}
      <ExceptionsCard isAdmin={isAdmin} />
      <BlocksCard />
    </div>
  )
}

// ---------------------------------------------------------------- festivos y excepciones

function ExceptionsCard({ isAdmin }: { isAdmin: boolean }) {
  const timezone = useTimezone()
  const refresh = useRefreshAvailability()
  const [open, setOpen] = useState(false)
  const [toDelete, setToDelete] = useState<string | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'exceptions'], queryFn: settingsApi.exceptions })

  const remove = useMutation({
    mutationFn: (date: string) => settingsApi.deleteException(date),
    onSuccess: () => {
      toast.success('Excepción eliminada.')
      refresh()
      setToDelete(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <SettingsSection
      title='Festivos y horarios especiales'
      description='Cierra un día completo (festivo, vacaciones) o define un horario distinto para una fecha concreta.'
      footer={
        isAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus /> Añadir
          </Button>
        )
      }
    >
      {isLoading && <Skeleton className='h-24 w-full' />}
      {data?.length === 0 && (
        <EmptyState
          icon={CalendarOff}
          title='Sin excepciones próximas'
          description='Añade festivos o días con horario especial para que no se puedan reservar citas.'
          className='py-6'
        />
      )}
      {!!data?.length && (
        <ul className='divide-y rounded-lg border'>
          {data.map((e) => (
            <li key={e.date} className='flex items-center justify-between gap-3 p-3'>
              <div className='min-w-0'>
                <p className='font-medium'>{formatMediumDate(e.date)}</p>
                <p className='truncate text-sm text-muted-foreground'>
                  {e.closed ? 'Cerrado' : `Horario especial ${e.open_time}–${e.close_time}`}
                  {e.label && ` · ${e.label}`}
                </p>
              </div>
              {isAdmin && (
                <Button variant='ghost' size='icon' onClick={() => setToDelete(e.date)} aria-label={`Eliminar ${e.date}`}>
                  <Trash2 className='size-4' />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && <ExceptionDialog onOpenChange={setOpen} today={todayIn(timezone)} />}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title='Eliminar excepción'
        desc={toDelete ? `El ${formatMediumDate(toDelete)} volverá a seguir el horario semanal.` : ''}
        confirmText='Eliminar'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </SettingsSection>
  )
}

function ExceptionDialog({ onOpenChange, today }: { onOpenChange: (o: boolean) => void; today: string }) {
  const refresh = useRefreshAvailability()
  const form = useForm<ExceptionValues>({
    resolver: zodResolver(exceptionSchema),
    defaultValues: { date: today, closed: true, open_time: '10:00', close_time: '14:00', label: '' },
  })
  const closed = useWatch({ control: form.control, name: 'closed' })

  const save = useMutation({
    mutationFn: (v: ExceptionValues) =>
      settingsApi.saveException({
        date: v.date,
        closed: v.closed,
        open_time: v.closed ? null : v.open_time,
        close_time: v.closed ? null : v.close_time,
        break_start: null,
        break_end: null,
        label: v.label,
      }),
    onSuccess: (r) => {
      toast.success('Excepción guardada.')
      refresh()
      warnAffected(r.affectedAppointments)
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
          <DialogTitle>Nueva excepción</DialogTitle>
          <DialogDescription>Sustituye el horario semanal solo para esa fecha.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-4' noValidate>
            <FormField
              control={form.control}
              name='date'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input type='date' min={today} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='label'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder='Festivo local, vacaciones…' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SwitchField control={form.control} name='closed' label='Cerrado todo el día' />
            {!closed && (
              <div className='grid grid-cols-2 gap-3'>
                <FormField
                  control={form.control}
                  name='open_time'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Apertura</FormLabel>
                      <FormControl>
                        <Input type='time' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='close_time'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cierre</FormLabel>
                      <FormControl>
                        <Input type='time' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
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

// ---------------------------------------------------------------- bloqueos manuales

function BlocksCard() {
  const timezone = useTimezone()
  const refresh = useRefreshAvailability()
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'blocks'], queryFn: settingsApi.blocks })

  const remove = useMutation({
    mutationFn: (id: number) => settingsApi.deleteBlock(id),
    onSuccess: () => {
      toast.success('Bloqueo eliminado.')
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <SettingsSection
      title='Bloqueos manuales'
      description='Reserva un tramo concreto (reunión, formación, gestión) para que nadie pueda pedir cita en él.'
      footer={
        <Button onClick={() => setOpen(true)}>
          <Plus /> Bloquear horario
        </Button>
      }
    >
      {isLoading && <Skeleton className='h-24 w-full' />}
      {data?.length === 0 && (
        <EmptyState icon={Lock} title='No hay bloqueos próximos' description='Los bloqueos aparecen aquí y en el calendario.' className='py-6' />
      )}
      {!!data?.length && (
        <ul className='divide-y rounded-lg border'>
          {data.map((b) => (
            <li key={b.id} className='flex items-center justify-between gap-3 p-3'>
              <div className='min-w-0'>
                <p className='font-medium'>
                  {formatMediumDate(b.date)} · <span className='tabular-nums'>{b.startTime}–{b.endTime}</span>
                </p>
                {b.reason && <p className='truncate text-sm text-muted-foreground'>{b.reason}</p>}
              </div>
              <Button variant='ghost' size='icon' disabled={remove.isPending} onClick={() => remove.mutate(b.id)} aria-label='Eliminar bloqueo'>
                <Trash2 className='size-4' />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && <BlockDialog onOpenChange={setOpen} today={todayIn(timezone)} />}
    </SettingsSection>
  )
}

function BlockDialog({ onOpenChange, today }: { onOpenChange: (o: boolean) => void; today: string }) {
  const refresh = useRefreshAvailability()
  const form = useForm<BlockValues>({
    resolver: zodResolver(blockSchema),
    defaultValues: { date: today, start_time: '', end_time: '', reason: '' },
  })

  const save = useMutation({
    mutationFn: (v: BlockValues) => settingsApi.createBlock(v),
    onSuccess: (r) => {
      toast.success('Horario bloqueado.')
      refresh()
      warnAffected(r.affectedAppointments)
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
          <DialogTitle>Bloquear horario</DialogTitle>
          <DialogDescription>Nadie podrá reservar en este tramo.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-4' noValidate>
            <FormField
              control={form.control}
              name='date'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input type='date' min={today} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-2 gap-3'>
              <FormField
                control={form.control}
                name='start_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Desde</FormLabel>
                    <FormControl>
                      <Input type='time' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='end_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hasta</FormLabel>
                    <FormControl>
                      <Input type='time' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='reason'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder='Reunión de equipo' {...field} />
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
                Bloquear
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
