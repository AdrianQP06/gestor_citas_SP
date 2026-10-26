import { DateTime } from 'luxon'
import { all, type DB } from '../../shared/db.ts'
import { getException, getSettings, getWeek, type Settings } from '../settings/settings.service.ts'
import { addDays, dayBoundsUtc, isoWeekday, localToUtcIso, minutes, nowUtc, todayLocal } from '../../shared/time.ts'

export type Audience = 'public' | 'staff'

export type Candidate = {
  time: string
  startsAt: string
  endsAt: string
  available: boolean
  reason?: UnavailableReason
}

export type UnavailableReason =
  | 'past'
  | 'too_soon'
  | 'too_far'
  | 'closed'
  | 'break'
  | 'blocked'
  | 'taken'

export const REASON_MESSAGES: Record<UnavailableReason, string> = {
  past: 'Ese horario ya ha pasado.',
  too_soon: 'Ese horario requiere más antelación para reservar.',
  too_far: 'Todavía no se admiten reservas para esa fecha.',
  closed: 'Ese día u hora está fuera del horario de atención.',
  break: 'Ese horario coincide con un descanso.',
  blocked: 'Ese horario no está disponible.',
  taken: 'Ese horario ya está ocupado. Elige otro, por favor.',
}

type DayWindow = { open: string; close: string; breakStart: string | null; breakEnd: string | null }

/** Horario efectivo de una fecha local: la excepción tiene prioridad sobre el horario semanal. */
export async function getDayWindow(db: DB, date: string): Promise<DayWindow | null> {
  const ex = await getException(db, date)
  if (ex) {
    if (ex.closed || !ex.open_time || !ex.close_time) return null
    return { open: ex.open_time, close: ex.close_time, breakStart: ex.break_start, breakEnd: ex.break_end }
  }
  const day = (await getWeek(db)).find((d) => d.weekday === isoWeekday(date))
  if (!day || !day.enabled) return null
  return { open: day.open_time, close: day.close_time, breakStart: day.break_start, breakEnd: day.break_end }
}

type Interval = { starts_at: string; ends_at: string }

/**
 * Calcula todos los horarios candidatos de un día (rejilla = duración + intervalo entre citas)
 * indicando cuáles están libres y, si no, por qué. Es la única fuente de verdad de la
 * disponibilidad: la usan tanto el listado de horarios como la validación al reservar.
 */
export async function getCandidates(
  db: DB,
  date: string,
  opts: { audience: Audience; excludeId?: number; now?: DateTime; settings?: Settings }
): Promise<Candidate[]> {
  const s = opts.settings ?? (await getSettings(db))
  const now = opts.now ?? nowUtc()
  const win = await getDayWindow(db, date)
  if (!win) return []

  const dur = s.appointment_duration_min
  const step = dur + s.buffer_min
  const today = todayLocal(s.timezone, now)
  const lastDate = addDays(today, s.max_advance_days)

  const { start: dayStart, end: dayEnd } = dayBoundsUtc(date, s.timezone)
  const pad = (iso: string, mins: number) => DateTime.fromISO(iso, { zone: 'utc' }).plus({ minutes: mins }).toISO()!
  const busy = await all<Interval>(
    db,
    `SELECT starts_at, ends_at FROM appointments
     WHERE status IN ('pending', 'confirmed', 'completed')
       AND starts_at < $hi AND ends_at > $lo AND id != $ex`,
    { lo: pad(dayStart, -s.buffer_min), hi: pad(dayEnd, s.buffer_min), ex: opts.excludeId ?? -1 }
  )
  const blocks = await all<Interval>(db, 'SELECT starts_at, ends_at FROM blocks WHERE starts_at < $hi AND ends_at > $lo', {
    lo: dayStart,
    hi: dayEnd,
  })

  const out: Candidate[] = []
  const open = minutes(win.open)
  const close = minutes(win.close)
  const bs = win.breakStart ? minutes(win.breakStart) : null
  const be = win.breakEnd ? minutes(win.breakEnd) : null

  for (let t = open; t + dur <= close; t += step) {
    const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    const startsAt = localToUtcIso(date, time, s.timezone)
    if (!startsAt) continue
    const endsAt = pad(startsAt, dur)
    const c: Candidate = { time, startsAt, endsAt, available: true }
    const fail = (reason: UnavailableReason) => {
      c.available = false
      c.reason = reason
    }

    const startDt = DateTime.fromISO(startsAt, { zone: 'utc' })
    if (startDt <= now) fail('past')
    else if (opts.audience === 'public' && startDt < now.plus({ minutes: s.min_notice_min })) fail('too_soon')
    else if (opts.audience === 'public' && date > lastDate) fail('too_far')
    else if (bs !== null && be !== null && t < be && bs < t + dur) fail('break')
    else if (blocks.some((b) => b.starts_at < endsAt && startsAt < b.ends_at)) fail('blocked')
    else if (
      busy.some((b) => b.starts_at < pad(endsAt, s.buffer_min) && startsAt < pad(b.ends_at, s.buffer_min))
    )
      fail('taken')
    out.push(c)
  }
  return out
}

export async function getAvailableSlots(
  db: DB,
  date: string,
  opts: { audience: Audience; excludeId?: number; now?: DateTime; settings?: Settings }
) {
  return (await getCandidates(db, date, opts))
    .filter((c) => c.available)
    .map(({ time, startsAt, endsAt }) => ({ time, startsAt, endsAt }))
}

/** Días de un mes (AAAA-MM) con al menos un horario libre. */
export async function getAvailableDays(
  db: DB,
  month: string,
  opts: { audience: Audience; excludeId?: number; now?: DateTime }
): Promise<{ date: string; slots: number }[]> {
  const settings = await getSettings(db)
  const first = DateTime.fromISO(`${month}-01`, { zone: 'utc' })
  const result: { date: string; slots: number }[] = []
  for (let d = 0; d < first.daysInMonth!; d++) {
    const date = first.plus({ days: d }).toFormat('yyyy-MM-dd')
    const n = (await getAvailableSlots(db, date, { ...opts, settings })).length
    if (n > 0) result.push({ date, slots: n })
  }
  return result
}

/**
 * Valida que `date` + `time` sea un horario reservable. Debe llamarse dentro de la misma
 * transacción que inserta/modifica la cita para que la comprobación sea atómica.
 */
export async function assertSlotBookable(
  db: DB,
  date: string,
  time: string,
  opts: { audience: Audience; excludeId?: number; now?: DateTime; settings?: Settings }
): Promise<{ startsAt: string; endsAt: string; reason?: never } | { reason: UnavailableReason; message: string }> {
  const c = (await getCandidates(db, date, opts)).find((x) => x.time === time)
  if (!c) return { reason: 'closed', message: REASON_MESSAGES.closed }
  if (!c.available) return { reason: c.reason!, message: REASON_MESSAGES[c.reason!] }
  return { startsAt: c.startsAt, endsAt: c.endsAt }
}
