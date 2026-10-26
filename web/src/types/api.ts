/** Contratos de la API /api/v1 (reflejan las respuestas del backend). */

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed'
export type Role = 'admin' | 'staff'

export type SessionUser = { id: number; email: string; name: string; role: Role }

export type Appointment = {
  id: number
  publicToken: string
  status: AppointmentStatus
  source: 'staff' | 'portal'
  startsAt: string
  endsAt: string
  /** Fecha y hora LOCALES del negocio (ya convertidas por el servidor). */
  date: string
  time: string
  endTime: string
  reason: string
  internalNotes: string
  cancelledBy: 'staff' | 'client' | null
  cancelReason: string | null
  createdAt: string
  customer: { id: number; fullName: string; phone: string; email: string }
}

export type Paginated<T> = { total: number; items: T[] }

export type Customer = {
  id: number
  fullName: string
  phone: string
  email: string
  notes: string
  createdAt: string
  totalAppointments: number
  upcomingAppointments: number
  lastAppointmentDate: string | null
}

export type Slot = { time: string; startsAt: string; endsAt: string }
export type AvailableDay = { date: string; slots: number }

export type DayHours = {
  weekday: number
  enabled: boolean
  open_time: string
  close_time: string
  break_start: string | null
  break_end: string | null
}

export type DateException = {
  date: string
  closed: boolean
  open_time: string | null
  close_time: string | null
  break_start: string | null
  break_end: string | null
  label: string
}

export type CalendarBlock = {
  id: number
  reason: string
  date: string
  startTime: string
  endDate: string
  endTime: string
}

export type CalendarData = {
  appointments: Appointment[]
  blocks: CalendarBlock[]
  week: DayHours[]
  exceptions: DateException[]
  durationMin: number
  bufferMin: number
}

export type Block = { id: number; reason: string; date: string; startTime: string; endTime: string }

export type Settings = {
  business_name: string
  timezone: string
  address: string
  contact_phone: string
  portal_welcome: string
  portal_enabled: boolean
  appointment_duration_min: number
  buffer_min: number
  min_notice_min: number
  max_advance_days: number
  allow_client_cancel: boolean
  allow_client_reschedule: boolean
  client_change_notice_hours: number
  auto_confirm: boolean
  reminder_minutes: number
}

export type WhatsAppStatus = {
  provider: 'test' | 'meta'
  configured: boolean
  testMode: boolean
  templateName: string | null
}

export type SettingsResponse = {
  settings: Settings
  week: DayHours[]
  whatsapp: WhatsAppStatus
  portalUrl: string
}

export type Recipient = { id: number; name: string; phone: string; active: boolean }

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'expired'

export type NotificationItem = {
  id: number
  status: NotificationStatus
  scheduledFor: string
  attempts: number
  lastError: string | null
  provider: 'test' | 'meta' | null
  sentAt: string | null
  appointmentId: number
  appointmentDate: string
  appointmentTime: string
  clientName: string
  recipientName: string
  recipientPhone: string
}

export type TeamUser = {
  id: number
  email: string
  name: string
  role: Role
  active: boolean
  created_at: string
}

export type AuditItem = {
  id: number
  at: string
  actor: string
  action: string
  entity: string
  entityId: string | null
  detail: Record<string, unknown> | null
}

export type DashboardSummary = {
  today: { date: string; total: number; active: number; appointments: Appointment[] }
  counts: { upcomingWeek: number; pending: number; confirmed: number; cancelledLast30Days: number }
  upcoming: Appointment[]
  needsAttention: Appointment[]
  series: { date: string; active: number; cancelled: number }[]
  failedReminders: number
}

// ---- Portal público

export type PublicInfo = {
  enabled: boolean
  businessName: string
  address: string
  phone: string
  welcome: string
  timezone: string
  durationMin: number
  maxAdvanceDays: number
  autoConfirm: boolean
  rules: { allowCancel: boolean; allowReschedule: boolean; noticeHours: number }
}

export type Permission = { allowed: true } | { allowed: false; reason: string }

export type PublicAppointment = {
  token: string
  status: AppointmentStatus
  date: string
  time: string
  endTime: string
  startsAt: string
  reason: string
  cancelledBy: 'staff' | 'client' | null
  customer: { fullName: string; email: string; phone: string }
  business: { name: string; address: string; phone: string; timezone: string }
  permissions: { cancel: Permission; reschedule: Permission }
}

// ---- Reportes (mismo contrato que el backend: la pantalla y el PDF salen del mismo objeto)

export type ReportType =
  | 'operational'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'clients'
  | 'cancellations'
  | 'reasons'
  | 'upcoming'
  | 'operations'

export type ReportComparison = { previous: number; delta: number; deltaPct: number | null }

export type ReportKpi = {
  key: string
  label: string
  value: number | null
  format: 'count' | 'percent' | 'money'
  /** Moneda ISO de los indicadores monetarios (value en unidades mayores, p. ej. 50.3). */
  currency?: string
  hint?: string
  comparison?: ReportComparison | null
  insufficient?: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'gold'
}

export type ReportChart = {
  id: string
  title: string
  kind: 'line' | 'bar' | 'groupedBar' | 'donut' | 'hbar'
  categories: string[]
  series: { name: string; values: number[]; color?: string }[]
  colors?: string[]
  note?: string
}

export type ReportTable = {
  id: string
  title: string
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center'; weight?: number }[]
  rows: Record<string, string | number>[]
  totals?: Record<string, string | number>
  omittedRows?: number
  totalRows: number
  emptyMessage: string
}

export type ReportData = {
  type: ReportType
  title: string
  subtitle: string
  business: string
  timezone: string
  generatedAt: string
  period: { from: string; to: string; days: number; previous: { from: string; to: string } | null }
  filters: { from: string; to: string; statuses: string[]; reason: string }
  filterSummary: string[]
  empty: boolean
  emptyMessage: string
  kpis: ReportKpi[]
  charts: ReportChart[]
  tables: ReportTable[]
  notes: string[]
}

export type ReportOptions = { types: { type: ReportType; title: string }[]; reasons: string[] }

// ---- Operaciones (depósitos y reembolsos registrados en una cita)

export type OperationType = 'deposit' | 'refund'
export type OperationProduct = 'daily' | 'master_business'
export type OperationStatus = 'pending' | 'confirmed' | 'voided'
export type OperationCurrency = 'USD' | 'EUR'

export type Operation = {
  id: number
  code: string
  appointmentId: number
  type: OperationType
  typeLabel: string
  product: OperationProduct | null
  productLabel: string | null
  amountMinor: number
  /** Decimal con 2 decimales, p. ej. "50.00". */
  amount: string
  currency: OperationCurrency
  /** Importe + moneda ya formateados, p. ej. "50,00 USD". */
  amountLabel: string
  method: 'cash'
  methodLabel: string
  reference: string | null
  status: OperationStatus
  statusLabel: string
  createdAt: string
  createdBy: { id: number; name: string }
  confirmedAt: string | null
  confirmedBy: { id: number; name: string } | null
  voidedAt: string | null
  voidedBy: { id: number; name: string } | null
  voidReason: string | null
  appointment: { id: number; date: string; time: string; endTime: string; reason: string; clientName: string }
}

export type OperationEvent = {
  id: number
  at: string
  action: 'created' | 'confirmed' | 'voided'
  fromStatus: OperationStatus | null
  toStatus: OperationStatus
  userName: string
  note: string | null
}

export type OperationDetail = { operation: Operation; events: OperationEvent[] }

// ---- Solicitudes de atención al cliente (portal público → bandeja interna)

export type SupportReason = 'no_date' | 'urgent' | 'other'
export type SupportStatus = 'pending' | 'attended' | 'closed'

export type SupportRequest = {
  id: number
  fullName: string
  phone: string
  reason: SupportReason
  reasonLabel: string
  message: string | null
  status: SupportStatus
  statusLabel: string
  consentAt: string
  createdAt: string
  handledAt: string | null
  handledBy: string | null
  staffNote: string | null
}
