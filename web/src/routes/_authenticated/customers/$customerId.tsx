import { createFileRoute } from '@tanstack/react-router'
import { CustomerDetailPage } from '@/features/customers/detail'

export const Route = createFileRoute('/_authenticated/customers/$customerId')({
  component: CustomerDetailPage,
})
