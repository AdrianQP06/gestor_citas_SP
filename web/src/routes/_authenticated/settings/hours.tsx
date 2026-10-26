import { createFileRoute } from '@tanstack/react-router'
import { HoursSettings } from '@/features/settings/hours'

export const Route = createFileRoute('/_authenticated/settings/hours')({
  component: HoursSettings,
})
