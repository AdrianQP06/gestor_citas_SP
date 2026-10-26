import { z } from 'zod'
import { all, get, run, tx, type DB } from '../../shared/db.ts'
import { AppError, badRequest } from '../../shared/errors.ts'
import { DATE_RE, TIME_RE, isValidTimezone, minutes, localToUtcIso } from '../../shared/time.ts'

const hhmm = z.string().regex(TIME_RE, 'Hora no válida (HH:mm).')
const ymd = z.string().regex(DATE_RE, 'Fecha no válida (AAAA-MM-DD).')

export const settingsSchema = z.object({
  business_name: z.string().trim().min(2, 'Indica el nombre del negocio.').max(80),
  timezone: z.string().refine(isValidTimezone, 'Zona horaria no válida.'),
  address: z.string().trim().max(160).default(''),
  contact_phone: z.string().trim().max(30).default(''),
  portal_welcome: z.string().trim().max(300).default(''),
  portal_enabled: z.boolean(),
  appointment_duration_min: z.number().int().min(5, 'Mínimo 5 minutos.').max(480),
  buffer_min: z.number().int().min(0).max(120),
  min_notice_min: z.number().int().min(0).max(60 * 24 * 14),
  max_advance_days: z.number().int().min(1).max(365),
  allow_client_cancel: z.boolean(),
  allow_client_reschedule: z.boolean(),
  client_change_notice_hours: z.number().int().min(0).max(24 * 14),
  auto_confirm: z.boolean(),
  reminder_minutes: z.number().int().min(1).max(60 * 24),
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  business_name: 'Supernova',
  timezone: 'Europe/Madrid',
  address: '',
  contact_phone: '',
  portal_welcome: 'Elige el día y la hora que mejor te vengan. Te confirmaremos la cita lo antes posible.',
  portal_enabled: true,
  appointment_duration_min: 30,
  buffer_min: 0,
  min_notice_min: 120,
  max_advance_days: 60,
  allow_client_cancel: true,
  allow_client_reschedule: true,
  client_change_notice_hours: 24,
  auto_confirm: false,
  reminder_minutes: 20,
}

export async function getSettings(db: DB): Promise<Settings> {
  const row = await get<{ data: string }>(db, 'SELECT data FROM settings WHERE id = 1')
  if (!row) return DEFAULT_SETTINGS
  return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(row.data) })
}

export async function saveSettings(db: DB, input: unknown): Promise<Settings> {
  const parsed = settingsSchema.parse(input)
  await run(db, 'INSERT INTO settings (id, data) VALUES (1, $d) ON DUPLICATE KEY UPDATE data = VALUES(data)', {
    d: JSON.stringify(parsed),
  })
  return parsed
}

// ---------------------------------------------------------------- horario semanal

export const dayHoursSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    enabled: z.boolean(),
    open_time: hhmm,
    close_time: hhmm,
    break_start: hhmm.nullable(),
    break_end: hhmm.nullable(),
  })
  .superRefine((d, ctx) => validateDayShape(d, ctx))

type DayShape = { enabled?: boolean; open_time: string; close_time: string; break_start: string | null; break_end: string | null }

function validateDayShape(d: DayShape, ctx: z.RefinementCtx) {
  if (d.enabled === false) return
  if (minutes(d.close_time) <= minutes(d.open_time)) {
    ctx.addIssue({ code: 'custom', path: ['close_time'], message: 'El cierre debe ser posterior a la apertura.' })
  }
  if ((d.break_start === null) !== (d.break_end === null)) {
    ctx.addIssue({ code: 'custom', path: ['break_end'], message: 'Indica el inicio y el fin del descanso.' })
  } else if (d.break_start && d.break_end) {
    if (minutes(d.break_end) <= minutes(d.break_start)) {
      ctx.addIssue({ code: 'custom', path: ['break_end'], message: 'El descanso debe terminar después de empezar.' })
    } else if (minutes(d.break_start) < minutes(d.open_time) || minutes(d.break_end) > minutes(d.close_time)) {
      ctx.addIssue({ code: 'custom', path: ['break_start'], message: 'El descanso debe estar dentro del horario.' })
    }
  }
}

export const weekSchema = z
  .array(dayHoursSchema)
  .length(7)
  .refine((w) => new Set(w.map((d) => d.weekday)).size === 7, 'Debe incluir los 7 días de la semana.')

export type DayHours = {
  weekday: number
  enabled: boolean
  open_time: string
  close_time: string
  break_start: string | null
  break_end: string | null
}

type DayRow = Omit<DayHours, 'enabled'> & { enabled: number }

export async function getWeek(db: DB): Promise<DayHours[]> {
  const rows = await all<DayRow>(db, 'SELECT * FROM working_hours ORDER BY weekday')
  return rows.map((r) => ({ ...r, enabled: !!r.enabled }))
}

export async function saveWeek(db: DB, input: unknown): Promise<DayHours[]> {
  const week = weekSchema.parse(input)
  await tx(db, async () => {
    for (const d of week) {
      await run(
        db,
        `INSERT INTO working_hours (weekday, enabled, open_time, close_time, break_start, break_end)
         VALUES ($weekday, $enabled, $open, $close, $bs, $be)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), open_time = VALUES(open_time), close_time = VALUES(close_time),
           break_start = VALUES(break_start), break_end = VALUES(break_end)`,
        {
          weekday: d.weekday,
          enabled: d.enabled ? 1 : 0,
          open: d.open_time,
          close: d.close_time,
          bs: d.break_start,
          be: d.break_end,
        }
      )
    }
  })
  return getWeek(db)
}

// ---------------------------------------------------------------- excepciones por fecha

export const exceptionSchema = z
  .object({
    date: ymd,
    closed: z.boolean(),
    open_time: hhmm.nullable().default(null),
    close_time: hhmm.nullable().default(null),
    break_start: hhmm.nullable().default(null),
    break_end: hhmm.nullable().default(null),
    label: z.string().trim().max(80).default(''),
  })
  .superRefine((e, ctx) => {
    if (e.closed) return
    if (!e.open_time || !e.close_time) {
      ctx.addIssue({ code: 'custom', path: ['open_time'], message: 'Indica la hora de apertura y de cierre.' })
      return
    }
    validateDayShape({ ...e, open_time: e.open_time, close_time: e.close_time }, ctx)
  })

export type ExceptionRow = {
  date: string
  closed: boolean
  open_time: string | null
  close_time: string | null
  break_start: string | null
  break_end: string | null
  label: string
}

type ExceptionDb = Omit<ExceptionRow, 'closed'> & { closed: number }

export async function listExceptions(db: DB, fromDate?: string): Promise<ExceptionRow[]> {
  const rows = fromDate
    ? await all<ExceptionDb>(db, 'SELECT * FROM exceptions WHERE date >= $f ORDER BY date', { f: fromDate })
    : await all<ExceptionDb>(db, 'SELECT * FROM exceptions ORDER BY date')
  return rows.map((r) => ({ ...r, closed: !!r.closed }))
}

export async function getException(db: DB, date: string): Promise<ExceptionRow | undefined> {
  const r = await get<ExceptionDb>(db, 'SELECT * FROM exceptions WHERE date = $d', { d: date })
  return r ? { ...r, closed: !!r.closed } : undefined
}

export async function saveException(db: DB, input: unknown): Promise<ExceptionRow> {
  const e = exceptionSchema.parse(input)
  const clean = e.closed ? { open_time: null, close_time: null, break_start: null, break_end: null } : e
  await run(
    db,
    `INSERT INTO exceptions (date, closed, open_time, close_time, break_start, break_end, label)
     VALUES ($date, $closed, $open, $close, $bs, $be, $label)
     ON DUPLICATE KEY UPDATE closed = VALUES(closed), open_time = VALUES(open_time), close_time = VALUES(close_time),
       break_start = VALUES(break_start), break_end = VALUES(break_end), label = VALUES(label)`,
    {
      date: e.date,
      closed: e.closed ? 1 : 0,
      open: clean.open_time,
      close: clean.close_time,
      bs: clean.break_start,
      be: clean.break_end,
      label: e.label,
    }
  )
  return (await getException(db, e.date))!
}

export async function deleteException(db: DB, date: string): Promise<boolean> {
  return (await run(db, 'DELETE FROM exceptions WHERE date = $d', { d: date })).changes > 0
}

// ---------------------------------------------------------------- bloqueos manuales

export const blockInputSchema = z.object({
  date: ymd,
  start_time: hhmm,
  end_time: hhmm,
  reason: z.string().trim().max(120).default(''),
})

export type BlockRow = { id: number; starts_at: string; ends_at: string; reason: string }

export async function listBlocks(db: DB, fromIso?: string): Promise<BlockRow[]> {
  return fromIso
    ? all<BlockRow>(db, 'SELECT * FROM blocks WHERE ends_at > $f ORDER BY starts_at', { f: fromIso })
    : all<BlockRow>(db, 'SELECT * FROM blocks ORDER BY starts_at')
}

export async function createBlock(db: DB, input: unknown, tz: string): Promise<BlockRow> {
  const b = blockInputSchema.parse(input)
  if (minutes(b.end_time) <= minutes(b.start_time)) {
    throw new AppError(400, 'validation', 'La hora de fin debe ser posterior a la de inicio.', {
      end_time: 'La hora de fin debe ser posterior a la de inicio.',
    })
  }
  const starts = localToUtcIso(b.date, b.start_time, tz)
  const ends = localToUtcIso(b.date, b.end_time, tz)
  if (!starts || !ends) throw badRequest('Fecha u hora no válidas.')
  const info = await run(db, 'INSERT INTO blocks (starts_at, ends_at, reason) VALUES ($s, $e, $r)', {
    s: starts,
    e: ends,
    r: b.reason,
  })
  return (await get<BlockRow>(db, 'SELECT * FROM blocks WHERE id = $id', { id: info.lastInsertRowid }))!
}

export async function deleteBlock(db: DB, id: number): Promise<boolean> {
  return (await run(db, 'DELETE FROM blocks WHERE id = $id', { id })).changes > 0
}
