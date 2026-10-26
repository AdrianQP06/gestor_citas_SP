import { createFileRoute } from '@tanstack/react-router'
import { SupportRequestPage } from '@/features/portal/support-page'

export const Route = createFileRoute('/reservar/atencion')({
  component: SupportRequestPage,
})
