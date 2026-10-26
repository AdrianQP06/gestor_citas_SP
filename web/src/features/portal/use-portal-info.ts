import { useQuery } from '@tanstack/react-query'
import { portalApi } from '@/api/services'

export function usePortalInfo() {
  return useQuery({ queryKey: ['portal', 'info'], queryFn: portalApi.info, staleTime: 5 * 60_000 })
}
