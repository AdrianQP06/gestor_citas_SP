import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Eye, Download, Loader2, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { operationsApi } from '@/api/services'
import { formatDateTime } from '@/lib/format'
import type { Operation, OperationEvent } from '@/types/api'
import { useSession } from '@/hooks/use-session'
import { useTimezone } from '@/hooks/use-settings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PdfPreviewDialog } from '@/features/reports/pdf-preview-dialog'
import { NO_MONEY_NOTICE, OperationStatusBadge } from './operation-badges'

const ACTION_LABEL: Record<OperationEvent['action'], string> = {
  created: 'Registrada (pendiente de verificación)',
  confirmed: 'Confirmada',
  voided: 'Anulada',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='text-sm break-words'>{children}</dd>
    </div>
  )
}

type Props = { operationId: number; open: boolean; onOpenChange: (open: boolean) => void }

/** Detalle de una operación: datos, historial de cambios, acciones permitidas y recibo PDF. */
export function OperationDetailDialog({ operationId, open, onOpenChange }: Props) {
  const timezone = useTimezone()
  const session = useSession().data
  const queryClient = useQueryClient()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(false)

  const detail = useQuery({
    queryKey: ['operations', 'detail', operationId],
    queryFn: () => operationsApi.get(operationId),
    enabled: open,
  })
  const refresh = () =>
    Promise.all(['operations', 'reports'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

  const confirm = useMutation({
    mutationFn: () => operationsApi.confirm(operationId),
    onSuccess: () => {
      toast.success('Operación confirmada.')
      return refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const voidOp = useMutation({
    mutationFn: () => operationsApi.void(operationId, reason.trim()),
    onSuccess: () => {
      toast.success('Operación anulada.')
      setVoiding(false)
      setReason('')
      return refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const op: Operation | undefined = detail.data?.operation
  const isAdmin = session?.role === 'admin'
  // Mismas reglas que el servidor (que es quien decide): confirmar solo admin; anular pendiente = creador o admin; confirmada = admin.
  const canConfirm = !!op && isAdmin && op.status === 'pending'
  const canVoid =
    !!op && op.status !== 'voided' && (isAdmin || (op.status === 'pending' && op.createdBy.id === session?.id))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{op ? `Operación ${op.code}` : 'Operación'}</DialogTitle>
            <DialogDescription>{op ? `${op.typeLabel} · ${op.appointment.clientName}` : 'Cargando…'}</DialogDescription>
          </DialogHeader>

          {detail.isLoading && <Skeleton className='h-48 w-full' />}
          {detail.isError && <p className='text-sm text-destructive'>{errorMessage(detail.error)}</p>}

          {op && detail.data && (
            <div className='space-y-5'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className={`text-2xl font-bold tabular-nums ${op.status === 'voided' ? 'line-through opacity-60' : ''}`}>{op.amountLabel}</p>
                <OperationStatusBadge status={op.status} />
              </div>

              <dl className='grid grid-cols-2 gap-3'>
                <Field label='Tipo'>{op.typeLabel}</Field>
                <Field label='Producto'>{op.productLabel ?? '—'}</Field>
                <Field label='Método'>Método: {op.methodLabel}</Field>
                <Field label='Moneda'>{op.currency}</Field>
                <Field label='Referencia'>{op.reference ?? 'Sin referencia'}</Field>
                <Field label='Registrada por'>
                  {op.createdBy.name} · {formatDateTime(op.createdAt, timezone)}
                </Field>
                {op.confirmedBy && op.confirmedAt && (
                  <Field label='Confirmada por'>
                    {op.confirmedBy.name} · {formatDateTime(op.confirmedAt, timezone)}
                  </Field>
                )}
                {op.voidedBy && op.voidedAt && (
                  <Field label='Anulada por'>
                    {op.voidedBy.name} · {formatDateTime(op.voidedAt, timezone)}
                  </Field>
                )}
                {op.voidReason && <Field label='Motivo de la anulación'>{op.voidReason}</Field>}
              </dl>

              <div className='space-y-2'>
                <h3 className='text-sm font-semibold'>Historial</h3>
                <ol className='space-y-2 border-s ps-4'>
                  {detail.data.events.map((e) => (
                    <li key={e.id} className='text-sm'>
                      <p className='font-medium'>{ACTION_LABEL[e.action]}</p>
                      <p className='text-xs text-muted-foreground'>
                        {e.userName} · {formatDateTime(e.at, timezone)}
                      </p>
                      {e.note && <p className='text-xs'>Motivo: {e.note}</p>}
                    </li>
                  ))}
                </ol>
              </div>

              <p className='text-xs text-muted-foreground'>{NO_MONEY_NOTICE}</p>

              <div className='flex flex-wrap justify-end gap-2'>
                <Button variant='outline' onClick={() => setPreview(true)}>
                  <Eye /> Recibo PDF
                </Button>
                <Button variant='outline' asChild>
                  <a href={operationsApi.receiptUrl(op.id, true, op.appointmentId)}>
                    <Download /> Descargar
                  </a>
                </Button>
                {canVoid && (
                  <Button variant='ghost' className='text-destructive hover:text-destructive' onClick={() => setVoiding(true)}>
                    <Ban /> Anular
                  </Button>
                )}
                {canConfirm && (
                  <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                    {confirm.isPending ? <Loader2 className='animate-spin' /> : <CheckCircle2 />}
                    Confirmar
                  </Button>
                )}
              </div>
              {op.status === 'pending' && !isAdmin && (
                <p className='text-xs text-muted-foreground'>Solo un administrador puede confirmar una operación.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {op && (
        <PdfPreviewDialog
          open={preview}
          onOpenChange={setPreview}
          title={`Recibo ${op.code}`}
          previewUrl={operationsApi.receiptUrl(op.id, false, op.appointmentId)}
          downloadUrl={operationsApi.receiptUrl(op.id, true, op.appointmentId)}
        />
      )}

      <ConfirmDialog
        open={voiding}
        onOpenChange={setVoiding}
        title='Anular operación'
        desc='La operación quedará anulada de forma definitiva: se conserva el registro y su historial, pero deja de contar en los totales vigentes.'
        confirmText='Anular operación'
        cancelBtnText='Mantener'
        destructive
        isLoading={voidOp.isPending}
        disabled={reason.trim().length < 3}
        handleConfirm={() => voidOp.mutate()}
      >
        <div className='space-y-2'>
          <Label htmlFor='void-reason'>Motivo (obligatorio, mínimo 3 caracteres)</Label>
          <Textarea id='void-reason' rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </>
  )
}
