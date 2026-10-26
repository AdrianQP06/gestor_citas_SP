import { Hono } from 'hono'
import { badRequest } from '../../shared/errors.ts'
import { all, type DB } from '../../shared/db.ts'
import { DATE_RE, addDays, dayBoundsUtc, localDateOf, localTimeOf } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { getSettings, getWeek, listExceptions } from '../settings/settings.service.ts'
import { listAppointments } from './appointments.service.ts'

/** Datos para pintar el calendario (citas, bloqueos y horario). Montado en /api/v1/calendar. */
export function calendarRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))

  app.get('/', async (c) => {
    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from || to > addDays(from, 45))
      throw badRequest('Rango de fechas no válido.')
    const settings = await getSettings(db)
    const tz = settings.timezone
    const appointments = (await listAppointments(db, { from, to, sort: 'asc' })).items
    const bounds = { lo: dayBoundsUtc(from, tz).start, hi: dayBoundsUtc(to, tz).end }
    const blocks = (await all<{ id: number; starts_at: string; ends_at: string; reason: string }>(
      db,
      'SELECT * FROM blocks WHERE starts_at < $hi AND ends_at > $lo ORDER BY starts_at',
      bounds
    )).map((b) => ({
      id: b.id,
      reason: b.reason,
      date: localDateOf(b.starts_at, tz),
      startTime: localTimeOf(b.starts_at, tz),
      endDate: localDateOf(b.ends_at, tz),
      endTime: localTimeOf(b.ends_at, tz),
    }))
    return c.json({
      appointments,
      blocks,
      week: await getWeek(db),
      exceptions: (await listExceptions(db)).filter((e) => e.date >= from && e.date <= to),
      durationMin: settings.appointment_duration_min,
      bufferMin: settings.buffer_min,
    })
  })

  return app
}
