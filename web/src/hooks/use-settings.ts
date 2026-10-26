import { queryOptions, useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/services'

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: settingsApi.get,
  staleTime: 60_000,
})

export const useSettings = () => useQuery(settingsQuery)

/** Zona horaria del negocio (con valor por defecto mientras carga). */
export function useTimezone() {
  const { data } = useSettings()
  return data?.settings.timezone ?? 'Europe/Madrid'
}
