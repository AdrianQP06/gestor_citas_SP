import { z } from 'zod'
import { DATE_RE, TIME_RE } from '../../shared/time.ts'

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{7,25}$/, 'Teléfono no válido.')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length
    return digits >= 7 && digits <= 15
  }, 'Teléfono no válido.')

export const customerFieldsSchema = z.object({
  fullName: z.string().trim().min(2, 'Indica el nombre completo.').max(100),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email('Correo electrónico no válido.').max(120),
})

const slotFields = {
  date: z.string().regex(DATE_RE, 'Fecha no válida.'),
  time: z.string().regex(TIME_RE, 'Hora no válida.'),
}

const reasonSchema = z.string().trim().min(3, 'Cuéntanos brevemente el motivo.').max(300)

export const staffCreateSchema = customerFieldsSchema.extend({
  ...slotFields,
  reason: reasonSchema,
  internalNotes: z.string().trim().max(1000).default(''),
  status: z.enum(['pending', 'confirmed']).default('confirmed'),
})

export const publicCreateSchema = customerFieldsSchema.extend({
  ...slotFields,
  reason: reasonSchema,
  /** Campo trampa anti-bots: debe llegar vacío. */
  website: z.string().max(0).optional(),
})

export const staffUpdateSchema = customerFieldsSchema.partial().extend({
  reason: reasonSchema.optional(),
  internalNotes: z.string().trim().max(1000).optional(),
})

export const rescheduleSchema = z.object(slotFields)
export const cancelSchema = z.object({ reason: z.string().trim().max(300).default('') })
