import { ExternalLink, Share2 } from 'lucide-react'
import { useLayout } from '@/context/layout-provider'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { AppTitle } from './app-title'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { navGroups } from './data'

function PortalCard() {
  const { state } = useSidebar()
  if (state === 'collapsed') return null
  return (
    <div className='mx-2 rounded-lg border bg-background/60 p-3'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <Share2 className='size-4 text-primary' />
        Portal de reservas
      </div>
      <p className='mt-1 text-xs text-muted-foreground'>
        Tus clientes reservan solos desde un enlace público.
      </p>
      <Button asChild size='sm' variant='outline' className='mt-2 w-full'>
        <a href='/reservar' target='_blank' rel='noreferrer'>
          Abrir portal <ExternalLink className='size-3.5' />
        </a>
      </Button>
    </div>
  )
}

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavGroup key={group.title} {...group} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <PortalCard />
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
