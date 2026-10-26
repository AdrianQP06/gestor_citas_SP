import { createFileRoute } from '@tanstack/react-router'
import { ExceptionsSettings } from '@/features/settings/exceptions'

export const Route = createFileRoute('/_authenticated/settings/exceptions')({
  component: ExceptionsSettings,
})
