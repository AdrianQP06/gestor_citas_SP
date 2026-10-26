import { cn } from '@/lib/utils'
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_STYLES } from '@/lib/status'
import type { OperationStatus } from '@/types/api'
import { Badge } from '@/components/ui/badge'

export function OperationStatusBadge({ status, className }: { status: OperationStatus; className?: string }) {
  return (
    <Badge variant='outline' className={cn('font-medium', OPERATION_STATUS_STYLES[status], className)}>
      {OPERATION_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Aviso que acompaña a todo lo que muestra o registra operaciones: registrar no es mover dinero. */
export const NO_MONEY_NOTICE =
  'Esto es solo un registro. La aplicación no mueve dinero: registrar un importe no significa que se haya recibido o devuelto.'
