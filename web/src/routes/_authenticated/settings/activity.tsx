import { createFileRoute } from '@tanstack/react-router'
import { requireAdmin } from '@/features/settings/guards'
import { ActivitySettings } from '@/features/settings/activity'

export const Route = createFileRoute('/_authenticated/settings/activity')({
  beforeLoad: requireAdmin,
  component: ActivitySettings,
})
