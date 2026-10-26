import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Banknote, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import { operationsApi, type OperationInput } from '@/api/services'
import type { OperationCurrency, OperationProduct, OperationType } from '@/types/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NO_MONEY_NOTICE } from './operation-badges'

type Props = { appointmentId: number; open: boolean; onOpenChange: (open: boolean) => void }

const AMOUNT_RE = /^\d{1,7}([.,]\d{1,2})?$/

/**
 * Alta de una operación. El método NO se elige: es siempre «Efectivo» y lo fija el servidor
 * (que además rechaza cualquier otro valor). La moneda no tiene valor por defecto: hay que elegirla.
 */
export function OperationFormDialog({ appointmentId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<OperationType>('deposit')
  const [product, setProduct] = useState<OperationProduct | ''>('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<OperationCurrency | ''>('')
  const [reference, setReference] = useState('')
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const errors: Record<string, string> = {}
  if (type === 'deposit' && !product) errors.product = 'Elige el producto de la tarjeta.'
  const normalized = amount.trim()
  if (!normalized) errors.amount = 'Indica el importe.'
  else if (!AMOUNT_RE.test(normalized)) errors.amount = 'Importe no válido: números positivos con hasta 2 decimales.'
  else if (Number(normalized.replace(',', '.')) <= 0) errors.amount = 'El importe debe ser mayor que cero.'
  if (!currency) errors.currency = 'Elige la moneda.'
  const [touched, setTouched] = useState(false)
  const shown = (field: string) => (touched ? (errors[field] ?? serverErrors[field]) : serverErrors[field])

  const create = useMutation({
    mutationFn: (input: OperationInput) => operationsApi.create(input),
    onSuccess: ({ operation }) => {
      toast.success(`Operación ${operation.code} registrada como pendiente de verificación.`)
      void queryClient.invalidateQueries({ queryKey: ['operations'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) setServerErrors(e.fields)
      else toast.error(errorMessage(e))
    },
  })

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setTouched(true)
    setServerErrors({})
    if (Object.keys(errors).length || !currency) return
    create.mutate({
      appointmentId,
      type,
      ...(type === 'deposit' && product ? { product } : {}),
      amount: normalized.replace(',', '.'),
      currency,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    })
  }

  const err = (field: string) =>
    shown(field) ? (
      <p role='alert' className='text-xs text-destructive'>
        {shown(field)}
      </p>
    ) : null

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Registrar operación</DialogTitle>
          <DialogDescription>Depósito para una solicitud de tarjeta o reembolso al cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className='space-y-4'>
          <div className='space-y-2'>
            <Label>Tipo</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => {
                setType(v as OperationType)
                if (v === 'refund') setProduct('')
              }}
              className='grid-cols-2'
            >
              {(
                [
                  ['deposit', 'Depósito'],
                  ['refund', 'Reembolso'],
                ] as const
              ).map(([value, label]) => (
                <Label key={value} htmlFor={`op-type-${value}`} className='flex cursor-pointer items-center gap-2 rounded-md border p-3 font-normal'>
                  <RadioGroupItem id={`op-type-${value}`} value={value} />
                  {label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {type === 'deposit' && (
            <div className='space-y-1.5'>
              <Label htmlFor='op-product'>Producto</Label>
              <Select value={product} onValueChange={(v) => setProduct(v as OperationProduct)}>
                <SelectTrigger id='op-product' className='w-full' aria-invalid={!!shown('product')}>
                  <SelectValue placeholder='Elige un producto' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='daily'>Daily</SelectItem>
                  <SelectItem value='master_business'>Master Business</SelectItem>
                </SelectContent>
              </Select>
              {err('product')}
            </div>
          )}

          <div className='grid grid-cols-[1fr_8rem] gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='op-amount'>Importe</Label>
              <Input
                id='op-amount'
                inputMode='decimal'
                autoComplete='off'
                placeholder='0.00'
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!shown('amount')}
              />
              {err('amount')}
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='op-currency'>Moneda</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as OperationCurrency)}>
                <SelectTrigger id='op-currency' className='w-full' aria-invalid={!!shown('currency')}>
                  <SelectValue placeholder='Elige' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='USD'>USD</SelectItem>
                  <SelectItem value='EUR'>EUR</SelectItem>
                </SelectContent>
              </Select>
              {err('currency')}
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='op-reference'>Referencia (opcional)</Label>
            <Input
              id='op-reference'
              maxLength={60}
              autoComplete='off'
              placeholder='Ej.: nº de recibo interno'
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-invalid={!!shown('reference')}
            />
            {err('reference')}
          </div>

          <p className='flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
            <Banknote className='size-4 shrink-0 text-gold' />
            <span>
              Método: <strong>Efectivo</strong>
            </span>
          </p>
          <p className='flex gap-2 text-xs text-muted-foreground'>
            <Info className='mt-0.5 size-3.5 shrink-0' />
            {NO_MONEY_NOTICE} Se guardará como «Pendiente de verificación» hasta que un administrador la confirme.
          </p>

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancelar
            </Button>
            <Button type='submit' disabled={create.isPending}>
              {create.isPending && <Loader2 className='animate-spin' />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
