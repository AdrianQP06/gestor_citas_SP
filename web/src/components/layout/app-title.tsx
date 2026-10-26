import { Link } from '@tanstack/react-router'
import { BrandLogo } from '@/components/brand/logo'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function AppTitle() {
  const { setOpenMobile, state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' asChild className='hover:bg-transparent'>
          <Link to='/' onClick={() => setOpenMobile(false)} aria-label='Supernova · Gestor de citas'>
            {collapsed ? (
              <BrandLogo variant='mark' className='size-8 -ms-1' />
            ) : (
              <div className='flex min-w-0 flex-col gap-1'>
                <BrandLogo className='h-6' />
                <span className='text-[11px] leading-none font-medium tracking-wide text-muted-foreground uppercase'>
                  Gestor de citas
                </span>
              </div>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
