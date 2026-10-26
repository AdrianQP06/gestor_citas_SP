import { all, get, type DB } from '../../shared/db.ts'
import { listAppointments } from '../appointments/appointments.service.ts'
import { getSettings } from '../settings/settings.service.ts'
import { addDays, dayBoundsUtc, localDateOf, nowUtc, todayLocal } from '../../shared/time.ts'

export async function dashboardSummary(db: DB) {
  const settings = await getSettings(db)
  const tz = settings.timezone
  const now = nowUtc()
  const nowIso = now.toISO()!
  const today = todayLocal(tz, now)

  const todayList = (await listAppointments(db, { from: today, to: today, sort: 'asc' })).items
  const todayActive = todayList.filter((a) => a.status === 'pending' || a.status === 'confirmed')

  const weekEnd = addDays(today, 6)
  const upcomingWeek = (
    await listAppointments(db, {
      from: today,
      to: weekEnd,
      statuses: ['pending', 'confirmed'],
      sort: 'asc',
    })
  ).items.filter((a) => a.endsAt > nowIso)

  const count = async (sql: string, params: Record<string, string>) => Number((await get<{ n: number }>(db, sql, params))!.n)
  const pending = await count("SELECT COUNT(*) AS n FROM appointments WHERE status = 'pending' AND ends_at > $now", { now: nowIso })
  const confirmed = await count(
    "SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed' AND ends_at > $now",
    { now: nowIso }
  )
  const cancelled30 = await count(
    "SELECT COUNT(*) AS n FROM appointments WHERE status = 'cancelled' AND updated_at > $since",
    { since: now.minus({ days: 30 }).toISO()! }
  )

  // Serie de 14 días: 3 atrás y 10 adelante.
  const from = addDays(today, -3)
  const to = addDays(today, 10)
  const rows = await all<{ starts_at: string; status: string }>(
    db,
    'SELECT starts_at, status FROM appointments WHERE starts_at >= $from AND starts_at < $to',
    { from: dayBoundsUtc(from, tz).start, to: dayBoundsUtc(to, tz).end }
  )
  const series: { date: string; active: number; cancelled: number }[] = []
  for (let i = 0; i < 14; i++) series.push({ date: addDays(from, i), active: 0, cancelled: 0 })
  for (const r of rows) {
    const point = series.find((p) => p.date === localDateOf(r.starts_at, tz))
    if (!point) continue
    if (r.status === 'cancelled') point.cancelled++
    else point.active++
  }

  const needsAttention = (
    await listAppointments(db, { statuses: ['pending'], from: today, sort: 'asc', pageSize: 5 })
  ).items
  const failedReminders = await count(
    "SELECT COUNT(*) AS n FROM notifications WHERE status = 'failed' AND created_at > $since",
    { since: now.minus({ days: 7 }).toISO()! }
  )

  return {
    today: { date: today, total: todayList.length, active: todayActive.length, appointments: todayList },
    counts: { upcomingWeek: upcomingWeek.length, pending, confirmed, cancelledLast30Days: cancelled30 },
    upcoming: upcomingWeek.slice(0, 6),
    needsAttention,
    series,
    failedReminders,
  }
}
