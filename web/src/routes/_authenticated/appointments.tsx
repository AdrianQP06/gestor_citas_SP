import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AppointmentsPage } from '@/features/appointments'

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']).optional().catch(undefined),
  scope: z.enum(['upcoming', 'past', 'all']).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
})

export type AppointmentsSearch = z.infer<typeof searchSchema>

export const Route = createFileRoute('/_authenticated/appointments')({
  validateSearch: searchSchema,
  component: AppointmentsPage,
})
