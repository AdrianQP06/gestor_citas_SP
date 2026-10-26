import { createFileRoute } from '@tanstack/react-router'
import { ManagePage } from '@/features/portal/manage-page'

export const Route = createFileRoute('/reservar/cita/$token')({
  component: ManagePage,
})
