import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { Appointment } from '@/types/api'
import { AppointmentFormDialog } from './appointment-form-dialog'
import { AppointmentSheet } from './appointment-sheet'

type Prefill = { date?: string; time?: string; customer?: Appointment['customer'] }

type Ctx = {
  openCreate: (prefill?: Prefill) => void
  openDetail: (id: number) => void
}

const DialogsContext = createContext<Ctx | null>(null)

/**
 * Gestiona los diálogos globales de citas (alta y detalle) para que cualquier página
 * pueda abrirlos sin duplicar componentes.
 */
export function AppointmentDialogsProvider({ children }: { children: React.ReactNode }) {
  const [create, setCreate] = useState<{ open: boolean; prefill?: Prefill }>({ open: false })
  const [detailId, setDetailId] = useState<number | null>(null)

  const openCreate = useCallback((prefill?: Prefill) => setCreate({ open: true, prefill }), [])
  const openDetail = useCallback((id: number) => setDetailId(id), [])
  const value = useMemo(() => ({ openCreate, openDetail }), [openCreate, openDetail])

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <AppointmentFormDialog
        key={create.open ? JSON.stringify(create.prefill ?? {}) : 'closed'}
        mode='create'
        open={create.open}
        prefill={create.prefill}
        onOpenChange={(open) => setCreate((c) => ({ ...c, open }))}
        onCreated={(a) => setDetailId(a.id)}
      />
      <AppointmentSheet id={detailId} onClose={() => setDetailId(null)} />
    </DialogsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppointmentDialogs() {
  const ctx = useContext(DialogsContext)
  if (!ctx) throw new Error('useAppointmentDialogs debe usarse dentro de AppointmentDialogsProvider')
  return ctx
}
