import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { sessionQuery } from '@/hooks/use-session'

/** Las secciones solo para administradores redirigen al resto a la configuración general. */
export async function requireAdmin({ context }: { context: { queryClient: QueryClient } }) {
  const user = await context.queryClient.ensureQueryData(sessionQuery)
  if (user.role !== 'admin') throw redirect({ to: '/settings' })
}
