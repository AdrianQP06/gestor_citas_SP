import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CustomersPage } from '@/features/customers'

export const Route = createFileRoute('/_authenticated/customers/')({
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: CustomersPage,
})
