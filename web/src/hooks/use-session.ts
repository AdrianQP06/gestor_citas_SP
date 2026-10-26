import { queryOptions, useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/services'

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: authApi.me,
  staleTime: 5 * 60_000,
  retry: false,
})

export const useSession = () => useQuery(sessionQuery)

export function useIsAdmin() {
  const { data } = useSession()
  return data?.role === 'admin'
}
