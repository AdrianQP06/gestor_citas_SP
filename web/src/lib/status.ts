import type { AppointmentStatus, NotificationStatus, OperationStatus } from '@/types/api'

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
}

/** Clases por estado (usa los tokens del tema, válidas en claro y oscuro). */
export const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  confirmed: 'border-success/40 bg-success/15 text-emerald-700 dark:text-emerald-300',
  cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
  completed: 'border-border bg-muted text-muted-foreground',
}

/** Color de los eventos del calendario por estado. */
export const EVENT_STYLES: Record<AppointmentStatus, string> = {
  pending: 'border-l-warning bg-warning/15 hover:bg-warning/25',
  confirmed: 'border-l-primary bg-primary/10 hover:bg-primary/20',
  cancelled: 'border-l-destructive/50 bg-muted/60 text-muted-foreground line-through hover:bg-muted',
  completed: 'border-l-success bg-success/10 hover:bg-success/20',
}

export const NOTIFICATION_LABELS: Record<NotificationStatus, string> = {
  pending: 'Programado',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  expired: 'Caducado',
}

export const NOTIFICATION_STYLES: Record<NotificationStatus, string> = {
  pending: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  sending: 'border-primary/30 bg-primary/10 text-primary',
  sent: 'border-success/40 bg-success/15 text-emerald-700 dark:text-emerald-300',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground',
  expired: 'border-border bg-muted text-muted-foreground',
}

export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  pending: 'Pendiente de verificación',
  confirmed: 'Confirmada',
  voided: 'Anulada',
}

export const OPERATION_STATUS_STYLES: Record<OperationStatus, string> = {
  pending: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  confirmed: 'border-success/40 bg-success/15 text-emerald-700 dark:text-emerald-300',
  voided: 'border-destructive/30 bg-destructive/10 text-destructive',
}
