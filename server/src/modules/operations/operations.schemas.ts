import { z } from 'zod'
import { CURRENCIES, MoneyError, parseAmountToMinor } from './operations.money.ts'

export const OPERATION_TYPES = ['deposit', 'refund'] as const
export const PRODUCTS = ['daily', 'master_business'] as const
export const OPERATION_STATUSES = ['pending', 'confirmed', 'voided'] as const
/** El método de pago es siempre efectivo. No se admite ningún otro valor. */
export const METHOD = 'cash' as const

export type OperationType = (typeof OPERATION_TYPES)[number]
export type Product = (typeof PRODUCTS)[number]
export type OperationStatus = (typeof OPERATION_STATUSES)[number]

export const TYPE_LABEL: Record<OperationType, string> = { deposit: 'Depósito', refund: 'Reembolso' }
export const PRODUCT_LABEL: Record<Product, string> = { daily: 'Daily', master_business: 'Master Business' }
export const STATUS_LABEL_OP: Record<OperationStatus, string> = {
  pending: 'Pendiente de verificación',
  confirmed: 'Confirmada',
  voided: 'Anulada',
}
export const METHOD_LABEL = 'Efectivo'

const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return parseAmountToMinor(v)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof MoneyError ? e.message : 'Importe no válido.' })
    return z.NEVER
  }
})

export const createOperationSchema = z
  .object({
    appointmentId: z.number({ error: 'Falta la cita.' }).int().positive(),
    type: z.enum(OPERATION_TYPES, { error: 'Elige depósito o reembolso.' }),
    product: z.enum(PRODUCTS, { error: 'Elige Daily o Master Business.' }).nullish(),
    amount,
    currency: z.enum(CURRENCIES, { error: `Elige una moneda (${CURRENCIES.join(' o ')}).` }),
    // Se acepta únicamente «cash» (o que no venga): el backend lo fija y valida, no se confía en el cliente.
    method: z.literal(METHOD, { error: 'El único método admitido es Efectivo.' }).optional(),
    reference: z
      .string()
      .trim()
      .max(60, 'La referencia admite como máximo 60 caracteres.')
      .regex(/^[\p{L}\p{N} _.\-/#]*$/u, 'La referencia solo admite letras, números, espacios y - _ . / #')
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'deposit' && !v.product) {
      ctx.addIssue({ code: 'custom', path: ['product'], message: 'Elige el producto: Daily o Master Business.' })
    }
    if (v.type === 'refund' && v.product) {
      ctx.addIssue({ code: 'custom', path: ['product'], message: 'Los reembolsos no llevan producto.' })
    }
  })

export type CreateOperationInput = z.infer<typeof createOperationSchema>

export const voidOperationSchema = z.object({
  reason: z.string().trim().min(3, 'Indica el motivo de la anulación (mínimo 3 caracteres).').max(300),
})

export const listQuerySchema = z.object({
  appointmentId: z.coerce.number().int().positive('Indica la cita.'),
})
