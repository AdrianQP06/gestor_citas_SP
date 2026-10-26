import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ReportsPage } from '@/features/reports'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined)

export const Route = createFileRoute('/_authenticated/reports/$type')({
  validateSearch: z.object({
    from: date,
    to: date,
    status: z.string().max(80).optional().catch(undefined),
    reason: z.string().max(100).optional().catch(undefined),
  }),
  component: ReportsPage,
})
