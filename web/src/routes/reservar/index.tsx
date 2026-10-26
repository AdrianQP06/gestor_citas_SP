import { createFileRoute } from '@tanstack/react-router'
import { BookingPage } from '@/features/portal/booking-page'

export const Route = createFileRoute('/reservar/')({
  component: BookingPage,
})
