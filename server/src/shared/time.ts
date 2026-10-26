import { DateTime, IANAZone } from 'luxon'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz)
}

export function nowUtc(): DateTime {
  return DateTime.utc()
}

export function isoNow(): string {
  return nowUtc().toISO()!
}

/** Convierte fecha + hora locales del negocio en un instante UTC (ISO). Devuelve null si no existen. */
export function localToUtcIso(date: string, time: string, tz: string): string | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz })
  if (!dt.isValid) return null
  // Hora inexistente por cambio de horario (DST): Luxon la desplaza; la rechazamos.
  if (dt.toFormat('HH:mm') !== time) return null
  return dt.toUTC().toISO()
}

export function toLocal(iso: string, tz: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz)
}

export function localDateOf(iso: string, tz: string): string {
  return toLocal(iso, tz).toFormat('yyyy-MM-dd')
}

export function localTimeOf(iso: string, tz: string): string {
  return toLocal(iso, tz).toFormat('HH:mm')
}

export function todayLocal(tz: string, now: DateTime = nowUtc()): string {
  return now.setZone(tz).toFormat('yyyy-MM-dd')
}

/** Límites UTC [inicio, fin) de un día local. */
export function dayBoundsUtc(date: string, tz: string): { start: string; end: string } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day')
  return { start: start.toUTC().toISO()!, end: start.plus({ days: 1 }).startOf('day').toUTC().toISO()! }
}

export function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toFormat('yyyy-MM-dd')
}

/** Día de la semana ISO (1 = lunes ... 7 = domingo) de una fecha local. */
export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday
}
