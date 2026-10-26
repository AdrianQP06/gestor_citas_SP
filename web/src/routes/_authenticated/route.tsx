import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { sessionQuery } from '@/hooks/use-session'
import { settingsQuery } from '@/hooks/use-settings'

export const Route = createFileRoute('/_authenticated')({
  // Todas las páginas del panel exigen sesión; si no la hay, se envía al login recordando el destino.
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(sessionQuery)
    } catch {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    // Precarga la configuración (zona horaria, nombre del negocio) que usa casi toda la interfaz.
    await context.queryClient.ensureQueryData(settingsQuery).catch(() => undefined)
  },
  component: AuthenticatedLayout,
})
