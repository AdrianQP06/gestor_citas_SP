import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  Building2,
  CalendarClock,
  CalendarOff,
  History,
  MessageCircle,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UsersRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { useIsAdmin } from '@/hooks/use-session'

const items = [
  { to: '/settings', title: 'Negocio', icon: Building2 },
  { to: '/settings/booking', title: 'Reglas de reserva', icon: SlidersHorizontal },
  { to: '/settings/hours', title: 'Horario semanal', icon: CalendarClock },
  { to: '/settings/exceptions', title: 'Festivos y bloqueos', icon: CalendarOff },
  { to: '/settings/whatsapp', title: 'WhatsApp', icon: MessageCircle },
  { to: '/settings/team', title: 'Equipo', icon: UsersRound, adminOnly: true },
  { to: '/settings/activity', title: 'Actividad', icon: History, adminOnly: true },
  { to: '/settings/account', title: 'Mi cuenta', icon: UserCog },
] as const

export function SettingsLayout() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const isAdmin = useIsAdmin()
  const visible = items.filter((i) => !('adminOnly' in i && i.adminOnly) || isAdmin)

  return (
    <Page
      title='Configuración'
      description='Horarios, reglas de reserva, notificaciones y equipo.'
      actions={
        isAdmin ? (
          <span className='inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary'>
            <ShieldCheck className='size-3.5' /> Administrador
          </span>
        ) : undefined
      }
    >
      <div className='flex flex-col gap-6 lg:flex-row'>
        <nav aria-label='Secciones de configuración' className='lg:w-56 lg:shrink-0'>
          <ul className='flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0'>
            {visible.map(({ to, title, icon: Icon }) => {
              const active = to === '/settings' ? pathname === '/settings' : pathname.startsWith(to)
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className='size-4' />
                    {title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className='min-w-0 flex-1 space-y-6'>
          <Outlet />
        </div>
      </div>
    </Page>
  )
}
