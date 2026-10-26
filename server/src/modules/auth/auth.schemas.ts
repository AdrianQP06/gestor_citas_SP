import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(100)
  .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra.')
  .regex(/\d/, 'La contraseña debe incluir al menos un número.')

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo electrónico no válido.'),
  password: z.string().min(1, 'Indica tu contraseña.'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Indica tu contraseña actual.'),
  newPassword: passwordSchema,
})
