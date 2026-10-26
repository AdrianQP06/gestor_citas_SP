import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Receipt } from 'lucide-react'
import { operationsApi } from '@/api/services'
import { formatDateTime } from '@/lib/format'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { OperationDetailDialog } from './operation-detail-dialog'
import { OperationFormDialog } from './operation-form-dialog'
import { NO_MONEY_NOTICE, OperationStatusBadge } from './operation-badges'
import { ReceiptAccess } from './receipt-access'

/** Sección «Operaciones» del detalle de una cita: historial + alta. No altera la cita. */
export function OperationsSection({ appointmentId }: { appointmentId: number }) {
  const timezone = useTimezone()
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const list = useQuery({
    queryKey: ['operations', 'list', appointmentId],
    queryFn: () => operationsApi.list(appointmentId),
  })

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>Operaciones</h3>
        <Button size='sm' variant='outline' onClick={() => setCreating(true)}>
          <Plus /> Registrar
        </Button>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-2'>
        <span className='text-xs text-muted-foreground'>Recibo para entregar al cliente (entrega manual)</span>
        <ReceiptAccess appointmentId={appointmentId} operations={list.data ?? []} />
      </div>
      <p className='text-xs text-muted-foreground'>
        Depósitos de solicitudes de tarjeta (Daily / Master Business) y reembolsos. {NO_MONEY_NOTICE}
      </p>

      {list.isLoading && <Skeleton className='h-14 w-full' />}
      {list.isError && <p className='text-xs text-destructive'>No se pudieron cargar las operaciones.</p>}
      {list.data?.length === 0 && <p className='text-sm text-muted-foreground'>Esta cita no tiene operaciones registradas.</p>}

      <ul className='space-y-2'>
        {list.data?.map((op) => (
          <li key={op.id}>
            <button
              type='button'
              onClick={() => setOpenId(op.id)}
              className='flex w-full items-start gap-3 rounded-md border p-3 text-start transition-colors hover:bg-muted/50'
            >
              <Receipt className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1'>
                <span className='flex flex-wrap items-center justify-between gap-2'>
                  <span className={`text-sm font-medium ${op.status === 'voided' ? 'line-through opacity-60' : ''}`}>
                    {op.typeLabel}
                    {op.productLabel ? ` · ${op.productLabel}` : ''} · {op.amountLabel}
                  </span>
                  <OperationStatusBadge status={op.status} />
                </span>
                <span className='block text-xs text-muted-foreground'>
                  {op.code} · Método: {op.methodLabel} · {formatDateTime(op.createdAt, timezone)} · {op.createdBy.name}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {creating && <OperationFormDialog appointmentId={appointmentId} open onOpenChange={setCreating} />}
      {openId !== null && (
        <OperationDetailDialog operationId={openId} open onOpenChange={(o) => !o && setOpenId(null)} />
      )}
    </div>
  )
}
