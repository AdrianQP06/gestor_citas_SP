import { parseDate, toMinutes } from '@/lib/format'
import type { Appointment, CalendarBlock, CalendarData } from '@/types/api'

export type DayWindow =
  | { closed: true; label: string }
  | {
      closed: false
      open: number
      close: number
      breakStart: number | null
      breakEnd: number | null
      label: string
    }

/** Horario efectivo de una fecha (la excepción manda sobre el horario semanal). Solo para pintar. */
export function dayWindow(date: string, data: Pick<CalendarData, 'week' | 'exceptions'>): DayWindow {
  const ex = data.exceptions.find((e) => e.date === date)
  if (ex) {
    if (ex.closed || !ex.open_time || !ex.close_time) return { closed: true, label: ex.label || 'Cerrado' }
    return {
      closed: false,
      open: toMinutes(ex.open_time),
      close: toMinutes(ex.close_time),
      breakStart: ex.break_start ? toMinutes(ex.break_start) : null,
      breakEnd: ex.break_end ? toMinutes(ex.break_end) : null,
      label: ex.label,
    }
  }
  const dow = parseDate(date).getUTCDay()
  const weekday = dow === 0 ? 7 : dow
  const day = data.week.find((d) => d.weekday === weekday)
  if (!day || !day.enabled) return { closed: true, label: '' }
  return {
    closed: false,
    open: toMinutes(day.open_time),
    close: toMinutes(day.close_time),
    breakStart: day.break_start ? toMinutes(day.break_start) : null,
    breakEnd: day.break_end ? toMinutes(day.break_end) : null,
    label: '',
  }
}

export type Positioned = { appt: Appointment; col: number; cols: number }

/** Reparte en columnas las citas que se solapan en el tiempo (p. ej. una cancelada y otra nueva). */
export function layoutEvents(appts: Appointment[]): Positioned[] {
  const sorted = [...appts].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id)
  const out: Positioned[] = []
  let cluster: { appt: Appointment; col: number }[] = []
  let clusterEnd = ''
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    for (const c of cluster) out.push({ ...c, cols })
    cluster = []
  }
  for (const appt of sorted) {
    if (cluster.length && appt.startsAt >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.appt.endsAt > appt.startsAt).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ appt, col })
    if (appt.endsAt > clusterEnd) clusterEnd = appt.endsAt
  }
  flush()
  return out
}

/** Tramo (en minutos) de un bloqueo manual que cae dentro de `date`, o null si no la toca. */
export function blockSegment(block: CalendarBlock, date: string): { from: number; to: number } | null {
  if (date < block.date || date > block.endDate) return null
  return {
    from: date === block.date ? toMinutes(block.startTime) : 0,
    to: date === block.endDate ? toMinutes(block.endTime) : 24 * 60,
  }
}
