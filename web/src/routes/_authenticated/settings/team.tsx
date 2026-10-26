import { createFileRoute } from '@tanstack/react-router'
import { requireAdmin } from '@/features/settings/guards'
import { TeamSettings } from '@/features/settings/team'

export const Route = createFileRoute('/_authenticated/settings/team')({
  beforeLoad: requireAdmin,
  component: TeamSettings,
})
