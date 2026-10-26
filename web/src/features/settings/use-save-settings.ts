import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { settingsApi } from '@/api/services'
import type { Settings } from '@/types/api'

/**
 * Guarda un subconjunto de la configuración. El backend valida el objeto completo, así que se
 * combina el parche con los valores actuales (cada página edita solo sus campos).
 */
export function useSaveSettings(current: Settings | undefined, onError?: (e: unknown) => boolean) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => settingsApi.save({ ...current!, ...patch }),
    onSuccess: () => {
      toast.success('Configuración guardada.')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      // Cambios de horarios/reglas alteran la disponibilidad y los recordatorios.
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (e) => {
      if (!onError?.(e)) toast.error(errorMessage(e))
    },
  })
}
