import { z } from 'zod'

export const SUPPORT_REASONS = ['no_date', 'urgent', 'other'] as const
export const SUPPORT_STATUSES = ['pending', 'attended', 'closed'] as const
export type SupportReason = (typeof SUPPORT_REASONS)[number]
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export const REASON_LABEL: Record<SupportReason, string> = {
  no_date: 'No encuentro fecha',
  urgent: 'Necesito atención urgente',
  other: 'Otro motivo',
}
export const STATUS_LABEL_SUPPORT: Record<SupportStatus, string> = {
  pending: 'Pendiente',
  attended: 'Atendida',
  closed: 'Cerrada sin atender',
}

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{7,25}$/, 'Teléfono no válido.')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length
    return digits >= 7 && digits <= 15
  }, 'Teléfono no válido.')

/** Formulario público. `website` es un campo trampa: las personas lo dejan vacío. */
export const publicSupportSchema = z.object({
  fullName: z.string().trim().min(2, 'Indica tu nombre.').max(100),
  phone: phoneSchema,
  reason: z.enum(SUPPORT_REASONS, { error: 'Elige un motivo.' }),
  message: z
    .string()
    .trim()
    .max(300, 'Máximo 300 caracteres.')
    .optional()
    .transform((v) => v || undefined),
  consent: z.literal(true, { error: 'Debes aceptar que te contactemos para poder atender tu solicitud.' }),
  website: z.string().max(0).optional(),
})

export const handleSupportSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || undefined),
})

export const closeSupportSchema = z.object({
  note: z.string().trim().min(3, 'Indica brevemente por qué se cierra.').max(500),
})

export const supportListQuerySchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
})
