import type {
  Appointment,
  AppointmentStatus,
  AuditItem,
  AvailableDay,
  Block,
  CalendarData,
  Customer,
  DashboardSummary,
  DateException,
  DayHours,
  NotificationItem,
  Operation,
  OperationCurrency,
  OperationDetail,
  OperationProduct,
  OperationType,
  Paginated,
  PublicAppointment,
  PublicInfo,
  ReportData,
  ReportOptions,
  ReportType,
  Recipient,
  SessionUser,
  SupportReason,
  SupportRequest,
  SupportStatus,
  Settings,
  SettingsResponse,
  Slot,
  TeamUser,
  WhatsAppStatus,
} from '@/types/api'
import { API_BASE, del, get, patch, post, put } from './client'

// ---------------------------------------------------------------- auth
export const authApi = {
  me: () => get<{ user: SessionUser }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string) =>
    post<{ user: SessionUser }>('/auth/login', { email, password }).then((r) => r.user),
  logout: () => post<{ ok: true }>('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/auth/password', { currentPassword, newPassword }),
}

// ---------------------------------------------------------------- dashboard y calendario
export const dashboardApi = {
  summary: () => get<DashboardSummary>('/dashboard'),
}

export const calendarApi = {
  range: (from: string, to: string) => get<CalendarData>('/calendar', { from, to }),
}

// ---------------------------------------------------------------- citas
export type AppointmentFilters = {
  q?: string
  status?: AppointmentStatus[]
  from?: string
  to?: string
  customerId?: number
  sort?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export type AppointmentInput = {
  date: string
  time: string
  fullName: string
  phone: string
  email: string
  reason: string
  internalNotes: string
  status: 'pending' | 'confirmed'
}

export type AppointmentDetailsInput = {
  fullName?: string
  phone?: string
  email?: string
  reason?: string
  internalNotes?: string
}

const wrap = (p: Promise<{ appointment: Appointment }>) => p.then((r) => r.appointment)

export const appointmentsApi = {
  list: (f: AppointmentFilters) =>
    get<Paginated<Appointment>>('/appointments', {
      ...f,
      status: f.status?.length ? f.status.join(',') : undefined,
    }),
  get: (id: number) => wrap(get(`/appointments/${id}`)),
  create: (input: AppointmentInput) => wrap(post('/appointments', input)),
  update: (id: number, input: AppointmentDetailsInput) => wrap(patch(`/appointments/${id}`, input)),
  confirm: (id: number) => wrap(post(`/appointments/${id}/confirm`)),
  complete: (id: number) => wrap(post(`/appointments/${id}/complete`)),
  cancel: (id: number, reason: string) => wrap(post(`/appointments/${id}/cancel`, { reason })),
  reschedule: (id: number, date: string, time: string) =>
    wrap(post(`/appointments/${id}/reschedule`, { date, time })),
}

export const availabilityApi = {
  days: (month: string, excludeId?: number) =>
    get<{ days: AvailableDay[] }>('/availability/days', { month, excludeId }).then((r) => r.days),
  slots: (date: string, excludeId?: number) =>
    get<{ slots: Slot[] }>('/availability/slots', { date, excludeId }).then((r) => r.slots),
}

// ---------------------------------------------------------------- clientes
export const customersApi = {
  list: (q: string, page: number, pageSize = 20) =>
    get<Paginated<Customer>>('/customers', { q: q || undefined, page, pageSize }),
  get: (id: number) => get<{ customer: Customer; appointments: Appointment[] }>(`/customers/${id}`),
  update: (id: number, input: { fullName: string; phone: string; email: string; notes: string }) =>
    patch<{ customer: Customer }>(`/customers/${id}`, input).then((r) => r.customer),
}

// ---------------------------------------------------------------- configuración
export const settingsApi = {
  get: () => get<SettingsResponse>('/settings'),
  save: (s: Settings) => put<{ settings: Settings }>('/settings', s).then((r) => r.settings),
  saveWeek: (week: DayHours[]) => put<{ week: DayHours[] }>('/settings/week', week).then((r) => r.week),
  exceptions: () => get<{ exceptions: DateException[] }>('/settings/exceptions').then((r) => r.exceptions),
  saveException: (e: DateException) =>
    put<{ exception: DateException; affectedAppointments: number }>('/settings/exceptions', e),
  deleteException: (date: string) => del<{ ok: true }>(`/settings/exceptions/${date}`),
  blocks: () => get<{ blocks: Block[] }>('/settings/blocks').then((r) => r.blocks),
  createBlock: (b: { date: string; start_time: string; end_time: string; reason: string }) =>
    post<{ block: { id: number }; affectedAppointments: number }>('/settings/blocks', b),
  deleteBlock: (id: number) => del<{ ok: true }>(`/settings/blocks/${id}`),
}

export const whatsappApi = {
  recipients: () => get<{ recipients: Recipient[]; whatsapp: WhatsAppStatus }>('/whatsapp/recipients'),
  addRecipient: (r: { name: string; phone: string; active: boolean }) =>
    post<{ recipients: Recipient[] }>('/whatsapp/recipients', r),
  updateRecipient: (id: number, r: { name: string; phone: string; active: boolean }) =>
    patch<{ recipients: Recipient[] }>(`/whatsapp/recipients/${id}`, r),
  deleteRecipient: (id: number) => del<{ recipients: Recipient[] }>(`/whatsapp/recipients/${id}`),
  test: (recipientId: number) =>
    post<{ ok: true; provider: 'test' | 'meta'; messageId: string }>('/whatsapp/test', { recipientId }),
  notifications: (status: string | undefined, page: number) =>
    get<Paginated<NotificationItem>>('/notifications', { status, page, pageSize: 15 }),
  retry: (id: number) => post<{ ok: true }>(`/notifications/${id}/retry`),
}

export const usersApi = {
  list: () => get<{ users: TeamUser[] }>('/users').then((r) => r.users),
  create: (u: { name: string; email: string; password: string; role: 'admin' | 'staff' }) =>
    post<{ users: TeamUser[] }>('/users', u),
  update: (id: number, u: { name?: string; role?: 'admin' | 'staff'; active?: boolean; password?: string }) =>
    patch<{ users: TeamUser[] }>(`/users/${id}`, u),
}

export const auditApi = {
  list: () => get<{ items: AuditItem[] }>('/audit', { limit: 100 }).then((r) => r.items),
}

// ---------------------------------------------------------------- portal público (sin sesión)
export type PublicBookingInput = {
  date: string
  time: string
  fullName: string
  phone: string
  email: string
  reason: string
  website?: string
}

export const portalApi = {
  info: () => get<PublicInfo>('/public/info'),
  days: (month: string, token?: string) =>
    get<{ days: AvailableDay[] }>('/public/availability/days', { month, token }).then((r) => r.days),
  slots: (date: string, token?: string) =>
    get<{ slots: Pick<Slot, 'time' | 'startsAt'>[] }>('/public/availability/slots', { date, token }).then(
      (r) => r.slots
    ),
  book: (input: PublicBookingInput) =>
    post<{ appointment: PublicAppointment }>('/public/appointments', input).then((r) => r.appointment),
  get: (token: string) =>
    get<{ appointment: PublicAppointment }>(`/public/appointments/${token}`).then((r) => r.appointment),
  cancel: (token: string, reason: string) =>
    post<{ appointment: PublicAppointment }>(`/public/appointments/${token}/cancel`, { reason }).then(
      (r) => r.appointment
    ),
  reschedule: (token: string, date: string, time: string) =>
    post<{ appointment: PublicAppointment }>(`/public/appointments/${token}/reschedule`, { date, time }).then(
      (r) => r.appointment
    ),
  /** Solo REGISTRA la solicitud: no envía ningún mensaje ni confirma contacto. */
  requestSupport: (input: { fullName: string; phone: string; reason: SupportReason; message?: string; consent: true; website: string }) =>
    post<{ received: true }>('/public/support-requests', input),
}

// ---------------------------------------------------------------- atención al cliente (bandeja interna)
export const supportApi = {
  list: (status?: SupportStatus) =>
    get<{ requests: SupportRequest[]; pending: number }>('/support-requests', { status }),
  summary: () => get<{ pending: number }>('/support-requests/summary'),
  attend: (id: number, note?: string) =>
    post<{ request: SupportRequest }>(`/support-requests/${id}/attend`, { note }).then((r) => r.request),
  close: (id: number, note: string) =>
    post<{ request: SupportRequest }>(`/support-requests/${id}/close`, { note }).then((r) => r.request),
}

// ---------------------------------------------------------------- reportes
export type ReportFilterParams = { from?: string; to?: string; status?: string; reason?: string }

const reportQuery = (f: ReportFilterParams, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v)
  return p.toString()
}

export const reportsApi = {
  options: () => get<ReportOptions>('/reports/options'),
  get: (type: ReportType, f: ReportFilterParams) =>
    get<{ report: ReportData }>(`/reports/${type}`, { ...f }).then((r) => r.report),
  /** URL del PDF (misma sesión por cookie): inline para la vista previa, attachment para descargar. */
  pdfUrl: (type: ReportType, f: ReportFilterParams, download = false) =>
    `${API_BASE}/reports/${type}/pdf?${reportQuery(f, download ? { download: '1' } : {})}`,
}

// ---------------------------------------------------------------- operaciones
export type OperationInput = {
  appointmentId: number
  type: OperationType
  product?: OperationProduct
  /** Importe como texto decimal ("50.00"): el servidor lo convierte a unidades menores enteras. */
  amount: string
  currency: OperationCurrency
  reference?: string
}

export const operationsApi = {
  list: (appointmentId: number) =>
    get<{ operations: Operation[] }>('/operations', { appointmentId }).then((r) => r.operations),
  get: (id: number) => get<OperationDetail>(`/operations/${id}`),
  create: (input: OperationInput) => post<OperationDetail>('/operations', input),
  confirm: (id: number) => post<OperationDetail>(`/operations/${id}/confirm`),
  void: (id: number, reason: string) => post<OperationDetail>(`/operations/${id}/void`, { reason }),
  /** Recibo PDF (misma sesión por cookie): inline para la vista previa, attachment para descargar. */
  /** Con `appointmentId` el servidor exige que la operación pertenezca a esa cita (acceso rápido desde la cita). */
  receiptUrl: (id: number, download = false, appointmentId?: number) => {
    const q = new URLSearchParams()
    if (appointmentId !== undefined) q.set('appointmentId', String(appointmentId))
    if (download) q.set('download', '1')
    return `${API_BASE}/operations/${id}/receipt${q.size ? `?${q}` : ''}`
  },
}
