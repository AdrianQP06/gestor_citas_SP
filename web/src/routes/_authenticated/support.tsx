import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SupportInboxPage } from '@/features/support'

const searchSchema = z.object({
  status: z.enum(['pending', 'attended', 'closed']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/support')({
  validateSearch: searchSchema,
  component: SupportInboxPage,
})
