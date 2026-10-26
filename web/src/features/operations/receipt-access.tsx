import { useState } from 'react'
import { ChevronDown, Download, FileText } from 'lucide-react'
import { operationsApi } from '@/api/services'
import type { Operation } from '@/types/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PdfPreviewDialog } from '@/features/reports/pdf-preview-dialog'

const describe = (op: Operation) =>
  `${op.code} · ${op.typeLabel}${op.productLabel ? ` ${op.productLabel}` : ''} · ${op.amountLabel} · ${op.statusLabel}`

type Props = { appointmentId: number; operations: Operation[] }

/**
 * Acceso rápido al recibo desde la cita. La entrega al cliente es MANUAL: el personal abre o descarga el PDF.
 * Con una sola operación hay botones directos; con varias, se elige cuál por su código, tipo, importe y estado.
 * Siempre se pide el recibo con `appointmentId`: el servidor comprueba que la operación pertenece a esta cita.
 */
export function ReceiptAccess({ appointmentId, operations }: Props) {
  const [selected, setSelected] = useState<Operation | null>(null)

  if (operations.length === 0) {
    return (
      <Button size='sm' variant='outline' disabled title='Registra primero una operación para esta cita'>
        <FileText /> Recibo PDF
      </Button>
    )
  }

  return (
    <>
      {operations.length === 1 ? (
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' onClick={() => setSelected(operations[0]!)}>
            <FileText /> Ver recibo
          </Button>
          <Button size='sm' variant='outline' asChild>
            <a href={operationsApi.receiptUrl(operations[0]!.id, true, appointmentId)}>
              <Download /> Descargar
            </a>
          </Button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size='sm' variant='outline'>
              <FileText /> Recibo PDF <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-80'>
            <DropdownMenuLabel>Elige la operación</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {operations.map((op) => (
              <DropdownMenuItem key={op.id} onSelect={() => setSelected(op)} className='flex-col items-start gap-0.5'>
                <span className={op.status === 'voided' ? 'font-medium line-through opacity-70' : 'font-medium'}>
                  {op.typeLabel}
                  {op.productLabel ? ` · ${op.productLabel}` : ''} · {op.amountLabel}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {op.code} · {op.statusLabel}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {selected && (
        <PdfPreviewDialog
          open
          onOpenChange={(o) => !o && setSelected(null)}
          title={`Recibo — ${describe(selected)}`}
          previewUrl={operationsApi.receiptUrl(selected.id, false, appointmentId)}
          downloadUrl={operationsApi.receiptUrl(selected.id, true, appointmentId)}
        />
      )}
    </>
  )
}
