import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { GeneralError, NotFoundError } from '@/components/errors'
import { NavigationProgress } from '@/components/navigation-progress'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: () => (
    <>
      <NavigationProgress />
      <Outlet />
      <Toaster duration={5000} richColors closeButton />
    </>
  ),
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
