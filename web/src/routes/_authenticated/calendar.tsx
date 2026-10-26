import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CalendarPage } from '@/features/calendar'

const searchSchema = z.object({
  view: z.enum(['day', 'week', 'month']).optional().catch(undefined),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/_authenticated/calendar')({
  validateSearch: searchSchema,
  component: CalendarPage,
})
