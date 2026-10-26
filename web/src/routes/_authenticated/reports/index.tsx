import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/reports/')({
  beforeLoad: () => {
    throw redirect({ to: '/reports/$type', params: { type: 'operational' }, replace: true })
  },
})
