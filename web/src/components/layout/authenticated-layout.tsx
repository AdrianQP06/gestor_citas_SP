import { Outlet } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'
import { AppointmentDialogsProvider } from '@/features/appointments/appointment-dialogs'

export function AuthenticatedLayout({
  children,
}: {
  children?: React.ReactNode
}) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
    <LayoutProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <SkipToMain />
        <AppSidebar />
        <SidebarInset
          className={cn(
            // Contenedor de contenido para container queries
            '@container/content',
            // Layout fijo (calendario): altura completa sin desbordar
            'has-data-[layout=fixed]:h-svh',
            'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
          )}
        >
          <AppointmentDialogsProvider>{children ?? <Outlet />}</AppointmentDialogsProvider>
        </SidebarInset>
      </SidebarProvider>
    </LayoutProvider>
  )
}
