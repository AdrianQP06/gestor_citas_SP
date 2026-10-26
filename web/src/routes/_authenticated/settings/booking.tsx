import { createFileRoute } from '@tanstack/react-router'
import { BookingSettings } from '@/features/settings/booking'

export const Route = createFileRoute('/_authenticated/settings/booking')({
  component: BookingSettings,
})
