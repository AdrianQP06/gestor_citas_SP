import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LifeBuoy,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react'
import { type NavGroup } from '../types'

export const navGroups: NavGroup[] = [
  {
    title: 'Gestión',
    items: [
      { title: 'Panel', url: '/', icon: LayoutDashboard },
      { title: 'Calendario', url: '/calendar', icon: CalendarDays },
      { title: 'Citas', url: '/appointments', icon: ClipboardList },
      { title: 'Clientes', url: '/customers', icon: Users },
      { title: 'Atención al cliente', url: '/support', icon: LifeBuoy },
      { title: 'Reportes', url: '/reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Ajustes',
    items: [{ title: 'Configuración', url: '/settings', icon: Settings }],
  },
]
