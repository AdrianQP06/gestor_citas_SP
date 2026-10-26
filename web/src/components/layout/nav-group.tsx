import { Link, useLocation } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { type NavGroup as NavGroupProps, type NavLink } from './types'

export function NavGroup({ title, items }: NavGroupProps) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton
              asChild
              isActive={isActive(pathname, item)}
              tooltip={item.title}
            >
              <Link to={item.url} onClick={() => setOpenMobile(false)}>
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function isActive(pathname: string, item: NavLink) {
  if (item.url === '/') return pathname === '/'
  return pathname === item.url || pathname.startsWith(`${item.url}/`)
}
