import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { auditApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import { formatDateTime } from '@/lib/format'
import { useTimezone } from '@/hooks/use-settings'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import { SettingsSection } from './components'

const ACTIONS: Record<string, string> = {
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Intento de acceso fallido',
  'auth.logout': 'Cierre de sesión',
  'auth.password_change': 'Cambio de contraseña',
  'appointment.create': 'Cita creada',
  'appointment.update': 'Cita editada',
  'appointment.confirm': 'Cita confirmada',
  'appointment.complete': 'Cita completada',
  'appointment.cancel': 'Cita cancelada',
  'appointment.reschedule': 'Cita reprogramada',
  'customer.update': 'Cliente editado',
  'settings.update': 'Configuración modificada',
  'settings.week_update': 'Horario semanal modificado',
  'exception.save': 'Excepción guardada',
  'exception.delete': 'Excepción eliminada',
  'block.create': 'Bloqueo creado',
  'block.delete': 'Bloqueo eliminado',
  'recipient.create': 'Destinatario añadido',
  'recipient.update': 'Destinatario editado',
  'recipient.delete': 'Destinatario eliminado',
  'whatsapp.test': 'Mensaje de prueba enviado',
  'whatsapp.test_failed': 'Mensaje de prueba fallido',
  'reminder.failed': 'Recordatorio fallido',
  'notification.retry': 'Recordatorio reintentado',
  'user.create': 'Usuario creado',
  'user.update': 'Usuario modificado',
}

export function ActivitySettings() {
  const timezone = useTimezone()
  const { data, isLoading, error } = useQuery({ queryKey: ['audit'], queryFn: auditApi.list })

  return (
    <SettingsSection
      title='Registro de actividad'
      description='Las 100 operaciones más recientes: accesos, citas, configuración y envíos.'
    >
      {isLoading && <Skeleton className='h-48 w-full' />}
      {error && <p className='text-sm text-destructive'>{errorMessage(error)}</p>}
      {data?.length === 0 && <EmptyState icon={History} title='Sin actividad registrada' className='py-8' />}
      {!!data?.length && (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow className='bg-muted/40 hover:bg-muted/40'>
                <TableHead>Cuándo</TableHead>
                <TableHead>Quién</TableHead>
                <TableHead>Qué</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className='text-xs whitespace-nowrap text-muted-foreground'>
                    {formatDateTime(a.at, timezone)}
                  </TableCell>
                  <TableCell className='max-w-40 truncate text-sm'>{a.actor}</TableCell>
                  <TableCell className='text-sm'>
                    {ACTIONS[a.action] ?? a.action}
                    {a.entityId && <span className='text-muted-foreground'> · #{a.entityId}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SettingsSection>
  )
}
