/**
 * Utilidades de fecha. El servidor ya entrega fecha ("AAAA-MM-DD") y hora ("HH:mm") LOCALES a la
 * zona horaria del negocio, así que aquí NO se convierte nada entre zonas: solo se da formato.
 * Las fechas se tratan como mediodía UTC para que el formato no dependa de la zona del navegador.
 */
const LOCALE = 'es-ES'

export const parseDate = (date: string) => new Date(`${date}T12:00:00Z`)

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: 'UTC' })

const longFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const mediumFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' })
const shortFmt = fmt({ day: 'numeric', month: 'short' })
const monthFmt = fmt({ month: 'long', year: 'numeric' })
const weekdayShortFmt = fmt({ weekday: 'short' })
const weekdayLongFmt = fmt({ weekday: 'long' })

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const formatLongDate = (date: string) => capitalize(longFmt.format(parseDate(date)))
export const formatMediumDate = (date: string) => capitalize(mediumFmt.format(parseDate(date)).replace('.', ''))
export const formatShortDate = (date: string) => shortFmt.format(parseDate(date)).replace('.', '')
export const formatMonth = (date: string) => capitalize(monthFmt.format(parseDate(date)))
export const formatWeekdayShort = (date: string) => capitalize(weekdayShortFmt.format(parseDate(date)).replace('.', ''))
export const formatWeekday = (date: string) => capitalize(weekdayLongFmt.format(parseDate(date)))

export const toDateString = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(date: string, days: number): string {
  const d = parseDate(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toDateString(d)
}

export function addMonths(date: string, months: number): string {
  const d = parseDate(date)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  return toDateString(d)
}

/** Lunes de la semana de `date`. */
export function startOfWeek(date: string): string {
  const day = parseDate(date).getUTCDay() // 0 = domingo
  return addDays(date, -((day + 6) % 7))
}

export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`

export function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1)
}

export const monthOf = (date: string) => date.slice(0, 7)

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Fecha de hoy en la zona horaria del negocio. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  )
}

/** Minutos desde medianoche de "HH:mm". */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(
    new Date(iso)
  )
}

export function formatPhone(phone: string): string {
  return phone
}

export function whatsappShareUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
