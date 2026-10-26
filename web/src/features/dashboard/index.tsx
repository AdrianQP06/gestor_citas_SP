import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  Check,
  Clock,
  FlaskConical,
  Hourglass,
  Plus,
} from 'lucide-react'
import { dashboardApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import { formatLongDate, formatMediumDate } from '@/lib/format'
import { useSession } from '@/hooks/use-session'
import { useSettings } from '@/hooks/use-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/shared/empty-state'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { useAppointmentActions } from '@/features/appointments/use-appointment-actions'
import { useAppointmentDialogs } from '@/features/appointments/appointment-dialogs'
import { ActivityChart } from './activity-chart'
import { PortalLinkCard } from './portal-link-card'

function greeting(name: string) {
  const hour = new Date().getHours()
  const salutation = hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches'
  return `${salutation}, ${name.split(' ')[0]}`
}

export function DashboardPage() {
  const { data: user } = useSession()
  const { data: settings } = useSettings()
  const { openCreate, openDetail } = useAppointmentDialogs()
  const { confirm } = useAppointmentActions()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.summary,
    refetchInterval: 60_000,
  })

  const whatsapp = settings?.whatsapp

  return (
    <Page
      title={user ? greeting(user.name) : 'Panel'}
      description={data ? formatLongDate(data.today.date) : undefined}
      actions={
        <Button onClick={() => openCreate()}>
          <Plus /> Nueva cita
        </Button>
      }
    >
      <div className='space-y-6'>
        {whatsapp?.testMode && (
          <Alert>
            <FlaskConical />
            <AlertTitle>WhatsApp en modo de prueba</AlertTitle>
            <AlertDescription>
              Los recordatorios se registran pero no se envían a ningún teléfono. Configura la integración oficial
              para activar los envíos reales.{' '}
              <Link to='/settings/whatsapp' className='font-medium underline underline-offset-4'>
                Ver configuración
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {whatsapp && !whatsapp.testMode && !whatsapp.configured && (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertTitle>WhatsApp sin credenciales</AlertTitle>
            <AlertDescription>
              Los recordatorios esperan en cola hasta que se configuren las credenciales.{' '}
              <Link to='/settings/whatsapp' className='font-medium underline underline-offset-4'>
                Ver configuración
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {!!data?.failedReminders && (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertTitle>
              {data.failedReminders} recordatorio{data.failedReminders > 1 ? 's' : ''} de WhatsApp fallido
              {data.failedReminders > 1 ? 's' : ''} esta semana
            </AlertTitle>
            <AlertDescription>
              <Link to='/settings/whatsapp' className='font-medium underline underline-offset-4'>
                Revisar el registro de envíos
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertTitle>No se pudo cargar el panel</AlertTitle>
            <AlertDescription className='flex items-center gap-3'>
              {errorMessage(error)}
              <Button size='sm' variant='outline' onClick={() => refetch()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <StatCard
            label='Citas de hoy'
            icon={CalendarCheck}
            tone='gold'
            hero
            loading={isLoading}
            value={data?.today.active}
            hint={data ? `${data.today.total} en total hoy` : undefined}
          />
          <StatCard
            label='Próximos 7 días'
            icon={CalendarClock}
            loading={isLoading}
            value={data?.counts.upcomingWeek}
            hint='Pendientes y confirmadas'
            tone='success'
          />
          <StatCard
            label='Pendientes de confirmar'
            icon={Hourglass}
            loading={isLoading}
            value={data?.counts.pending}
            hint={`${data?.counts.confirmed ?? 0} confirmadas próximamente`}
            tone='warning'
          />
          <StatCard
            label='Canceladas (30 días)'
            icon={CalendarX2}
            loading={isLoading}
            value={data?.counts.cancelledLast30Days}
            tone='danger'
          />
        </div>

        <div className='grid gap-6 xl:grid-cols-3'>
          <div className='space-y-6 xl:col-span-2'>
            <Card>
              <CardHeader>
                <CardTitle>Agenda de hoy</CardTitle>
                <CardDescription>Citas del día en orden de hora.</CardDescription>
                <CardAction>
                  <Button variant='ghost' size='sm' asChild>
                    <Link to='/calendar'>
                      Ver calendario <ArrowRight />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className='px-0'>
                {isLoading && (
                  <div className='space-y-3 px-6'>
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className='h-14 w-full' />
                    ))}
                  </div>
                )}
                {data && data.today.appointments.length === 0 && (
                  <EmptyState
                    icon={CalendarCheck}
                    title='Hoy no hay citas'
                    description='Disfruta de un día tranquilo o crea una cita nueva.'
                    action={
                      <Button variant='outline' onClick={() => openCreate()}>
                        <Plus /> Nueva cita
                      </Button>
                    }
                  />
                )}
                <ul className='divide-y'>
                  {data?.today.appointments.map((a) => (
                    <li key={a.id}>
                      <button
                        type='button'
                        onClick={() => openDetail(a.id)}
                        className='flex w-full items-center gap-4 px-6 py-3 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none'
                      >
                        <div className='w-16 shrink-0 text-sm font-semibold tabular-nums'>
                          <Clock className='mb-0.5 me-1 inline size-3.5 text-muted-foreground' />
                          {a.time}
                        </div>
                        <div className='min-w-0 flex-1'>
                          <p className={a.status === 'cancelled' ? 'truncate font-medium line-through opacity-60' : 'truncate font-medium'}>
                            {a.customer.fullName}
                          </p>
                          <p className='truncate text-sm text-muted-foreground'>{a.reason}</p>
                        </div>
                        <StatusBadge status={a.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actividad de citas</CardTitle>
                <CardDescription>Últimos 3 días y próximos 10.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className='h-64 w-full' /> : data && <ActivityChart series={data.series} today={data.today.date} />}
              </CardContent>
            </Card>
          </div>

          <div className='space-y-6'>
            <Card>
              <CardHeader>
                <CardTitle>Por confirmar</CardTitle>
                <CardDescription>Reservas que esperan tu visto bueno.</CardDescription>
              </CardHeader>
              <CardContent className='px-0'>
                {isLoading && <Skeleton className='mx-6 h-16' />}
                {data && data.needsAttention.length === 0 && (
                  <EmptyState
                    icon={Check}
                    title='Todo al día'
                    description='No hay citas pendientes de confirmación.'
                    className='py-8'
                  />
                )}
                <ul className='divide-y'>
                  {data?.needsAttention.map((a) => (
                    <li key={a.id} className='flex items-center gap-3 px-6 py-3'>
                      <button type='button' onClick={() => openDetail(a.id)} className='min-w-0 flex-1 text-start'>
                        <p className='truncate text-sm font-medium'>{a.customer.fullName}</p>
                        <p className='truncate text-xs text-muted-foreground'>
                          {formatMediumDate(a.date)} · {a.time}
                        </p>
                      </button>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate(a.id)}
                      >
                        <Check /> Confirmar
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <PortalLinkCard
              url={settings?.portalUrl}
              enabled={settings?.settings.portal_enabled}
              businessName={settings?.settings.business_name}
            />
          </div>
        </div>
      </div>
    </Page>
  )
}
