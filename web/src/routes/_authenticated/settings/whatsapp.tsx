import { createFileRoute } from '@tanstack/react-router'
import { WhatsAppSettings } from '@/features/settings/whatsapp'

export const Route = createFileRoute('/_authenticated/settings/whatsapp')({
  component: WhatsAppSettings,
})
