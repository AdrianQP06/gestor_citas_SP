/**
 * Validación de FORMATO en el navegador (respuesta inmediata al escribir).
 * Las reglas de negocio (disponibilidad, solapamientos, plazos…) viven solo en el backend, que
 * valida todo de nuevo; sus mensajes se muestran en el formulario con `applyServerErrors`.
 */
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '@/api/client'

const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{7,25}$/, 'Teléfono no válido.')
  .refine((v) => {
    const d = v.replace(/\D/g, '').length
    return d >= 7 && d <= 15
  }, 'Teléfono no válido.')

export const customerFields = {
  fullName: z.string().trim().min(2, 'Indica el nombre completo.').max(100),
  phone,
  email: z.string().trim().email('Correo electrónico no válido.').max(120),
}

export const reasonField = z.string().trim().min(3, 'Cuéntanos brevemente el motivo.').max(300)

export const bookingSchema = z.object({ ...customerFields, reason: reasonField })
export type BookingValues = z.infer<typeof bookingSchema>

export const appointmentSchema = z.object({
  ...customerFields,
  reason: reasonField,
  internalNotes: z.string().trim().max(1000),
  status: z.enum(['pending', 'confirmed']),
})
export type AppointmentValues = z.infer<typeof appointmentSchema>

export const loginSchema = z.object({
  email: z.string().trim().email('Correo electrónico no válido.'),
  password: z.string().min(1, 'Indica tu contraseña.'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const passwordRule = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .regex(/[A-Za-z]/, 'Incluye al menos una letra.')
  .regex(/\d/, 'Incluye al menos un número.')

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Indica tu contraseña actual.'), newPassword: passwordRule, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' })
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>

const e164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Usa el formato internacional, p. ej. +34600111222.'))

export const recipientSchema = z.object({
  name: z.string().trim().min(2, 'Indica un nombre.').max(60),
  phone: e164,
  active: z.boolean(),
})

export const userSchema = z.object({
  name: z.string().trim().min(2, 'Indica el nombre.').max(80),
  email: z.string().trim().email('Correo electrónico no válido.'),
  password: passwordRule,
  role: z.enum(['admin', 'staff']),
})

export const customerEditSchema = z.object({ ...customerFields, notes: z.string().trim().max(2000) })
export type CustomerEditValues = z.infer<typeof customerEditSchema>

/** Vuelca los errores por campo que devuelve el backend en el formulario. Devuelve true si había alguno. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  let any = false
  for (const [field, message] of Object.entries(error.fields)) {
    if (field in form.getValues()) {
      form.setError(field as Path<T>, { type: 'server', message })
      any = true
    }
  }
  return any
}

// ---- Configuración (el servidor valida de nuevo y es la fuente de verdad)
export const generalSettingsSchema = z.object({
  business_name: z.string().trim().min(2, 'Indica el nombre del negocio.').max(80),
  timezone: z.string().min(1, 'Elige una zona horaria.'),
  address: z.string().trim().max(160),
  contact_phone: z.string().trim().max(30),
  portal_welcome: z.string().trim().max(300),
  portal_enabled: z.boolean(),
})
export type GeneralSettingsValues = z.infer<typeof generalSettingsSchema>

const num = (min: number, max: number, label: string) =>
  z
    .number({ error: `Indica ${label}.` })
    .int('Debe ser un número entero.')
    .min(min, `Mínimo ${min}.`)
    .max(max, `Máximo ${max}.`)

export const bookingSettingsSchema = z.object({
  appointment_duration_min: num(5, 480, 'la duración'),
  buffer_min: num(0, 120, 'el intervalo'),
  min_notice_min: num(0, 60 * 24 * 14, 'la antelación mínima'),
  max_advance_days: num(1, 365, 'los días de antelación'),
  auto_confirm: z.boolean(),
  allow_client_cancel: z.boolean(),
  allow_client_reschedule: z.boolean(),
  client_change_notice_hours: num(0, 24 * 14, 'las horas de antelación'),
})
export type BookingSettingsValues = z.infer<typeof bookingSettingsSchema>

export const reminderSettingsSchema = z.object({
  reminder_minutes: num(1, 60 * 24, 'los minutos del aviso'),
})
export type ReminderSettingsValues = z.infer<typeof reminderSettingsSchema>

export const exceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige una fecha.'),
    closed: z.boolean(),
    open_time: z.string(),
    close_time: z.string(),
    label: z.string().trim().max(80),
  })
  .refine((v) => v.closed || (v.open_time && v.close_time && v.close_time > v.open_time), {
    path: ['close_time'],
    message: 'El cierre debe ser posterior a la apertura.',
  })
export type ExceptionValues = z.infer<typeof exceptionSchema>

export const blockSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige una fecha.'),
    start_time: z.string().min(1, 'Indica la hora de inicio.'),
    end_time: z.string().min(1, 'Indica la hora de fin.'),
    reason: z.string().trim().max(120),
  })
  .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, {
    path: ['end_time'],
    message: 'La hora de fin debe ser posterior a la de inicio.',
  })
export type BlockValues = z.infer<typeof blockSchema>
