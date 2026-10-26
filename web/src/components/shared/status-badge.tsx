import { cn } from '@/lib/utils'
import {
  NOTIFICATION_LABELS,
  NOTIFICATION_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
} from '@/lib/status'
import type { AppointmentStatus, NotificationStatus } from '@/types/api'
import { Badge } from '@/components/ui/badge'

export function StatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn('font-medium', STATUS_STYLES[status], className)}
    >
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export function NotificationBadge({
  status,
  className,
}: {
  status: NotificationStatus
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn('font-medium', NOTIFICATION_STYLES[status], className)}
    >
      {NOTIFICATION_LABELS[status]}
    </Badge>
  )
}
