import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { settingsApi } from '@/api/services'
import { useIsAdmin } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'
import type { DayHours } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AdminOnlyNotice, SettingsSection } from './components'

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

/** Comprobación de formato para respuesta inmediata; el servidor valida de nuevo. */
function validateDay(d: DayHours): string | null {
  if (!d.enabled) return null
  if (d.close_time <= d.open_time) return 'El cierre debe ser posterior a la apertura.'
  if (d.break_start && d.break_end) {
    if (d.break_end <= d.break_start) return 'El descanso debe terminar después de empezar.'
    if (d.break_start < d.open_time || d.break_end > d.close_time) return 'El descanso debe estar dentro del horario.'
  }
  return null
}

export function HoursSettings() {
  const { data, isLoading } = useSettings()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  // Borrador local: null mientras no se haya editado (entonces se muestra lo guardado en el servidor).
  const [draft, setDraft] = useState<DayHours[] | null>(null)
  const week = draft ?? data?.week ?? []
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({})

  const save = useMutation({
    mutationFn: () => settingsApi.saveWeek(week),
    onSuccess: () => {
      toast.success('Horario guardado.')
      setServerErrors({})
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        const mapped: Record<number, string> = {}
        for (const [key, msg] of Object.entries(e.fields)) mapped[Number(key.split('.')[0])] ??= msg
        setServerErrors(mapped)
      }
      toast.error(errorMessage(e))
    },
  })

  if (isLoading || !data) return <Skeleton className='h-96 w-full' />

  const update = (idx: number, patch: Partial<DayHours>) => {
    setDraft(week.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
    setServerErrors((s) => ({ ...s, [idx]: '' }))
  }
  const errors = week.map((d, i) => serverErrors[i] || validateDay(d))
  const hasErrors = errors.some(Boolean)
  const dirty = JSON.stringify(week) !== JSON.stringify(data.week)

  const copyMondayToWeekdays = () => {
    const mon = week[0]!
    setDraft(week.map((d, i) => (i > 0 && i < 5 ? { ...mon, weekday: d.weekday } : d)))
  }

  return (
    <div className='space-y-6'>
      {!isAdmin && <AdminOnlyNotice />}
      <SettingsSection
        title='Horario semanal'
        description='Días laborables, apertura, cierre y un descanso opcional (por ejemplo, la comida). Los clientes solo ven horarios dentro de estas franjas.'
        footer={
          isAdmin && (
            <>
              <Button type='button' variant='outline' onClick={copyMondayToWeekdays}>
                <Copy /> Copiar lunes a lunes–viernes
              </Button>
              <Button onClick={() => save.mutate()} disabled={!dirty || hasErrors || save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                Guardar horario
              </Button>
            </>
          )
        }
      >
        <fieldset disabled={!isAdmin || save.isPending} className='divide-y rounded-lg border'>
          {week.map((d, i) => {
            const hasBreak = d.break_start !== null && d.break_end !== null
            const error = errors[i]
            return (
              <div key={d.weekday} className='space-y-2 p-3 sm:p-4'>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                  <div className='flex w-36 items-center gap-3'>
                    <Switch
                      checked={d.enabled}
                      onCheckedChange={(v) => update(i, { enabled: v })}
                      aria-label={`${DAY_NAMES[i]} laborable`}
                    />
                    <span className={d.enabled ? 'font-medium' : 'text-muted-foreground'}>{DAY_NAMES[i]}</span>
                  </div>
                  {d.enabled ? (
                    <>
                      <div className='flex items-center gap-2'>
                        <Input
                          type='time'
                          className='w-28'
                          value={d.open_time}
                          onChange={(e) => update(i, { open_time: e.target.value })}
                          aria-label={`Apertura del ${DAY_NAMES[i]}`}
                        />
                        <span className='text-muted-foreground'>a</span>
                        <Input
                          type='time'
                          className='w-28'
                          value={d.close_time}
                          onChange={(e) => update(i, { close_time: e.target.value })}
                          aria-label={`Cierre del ${DAY_NAMES[i]}`}
                        />
                      </div>
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox
                          checked={hasBreak}
                          onCheckedChange={(c) =>
                            update(i, c === true ? { break_start: '14:00', break_end: '15:00' } : { break_start: null, break_end: null })
                          }
                        />
                        Descanso
                      </label>
                      {hasBreak && (
                        <div className='flex items-center gap-2'>
                          <Input
                            type='time'
                            className='w-28'
                            value={d.break_start ?? ''}
                            onChange={(e) => update(i, { break_start: e.target.value })}
                            aria-label={`Inicio del descanso del ${DAY_NAMES[i]}`}
                          />
                          <span className='text-muted-foreground'>a</span>
                          <Input
                            type='time'
                            className='w-28'
                            value={d.break_end ?? ''}
                            onChange={(e) => update(i, { break_end: e.target.value })}
                            aria-label={`Fin del descanso del ${DAY_NAMES[i]}`}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <span className='text-sm text-muted-foreground'>Cerrado</span>
                  )}
                </div>
                {error && (
                  <p className='text-sm text-destructive' role='alert'>
                    {error}
                  </p>
                )}
              </div>
            )
          })}
        </fieldset>
      </SettingsSection>
    </div>
  )
}
