import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { sessionQuery } from '@/hooks/use-session'
import { SignInPage } from '@/features/auth/sign-in'

export const Route = createFileRoute('/sign-in')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  // Si ya hay sesión no se muestra el login.
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery(sessionQuery).catch(() => null)
    if (user) throw redirect({ to: '/' })
  },
  component: SignInPage,
})
