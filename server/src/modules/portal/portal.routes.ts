import { Hono } from 'hono'
import { body } from '../../http/helpers.ts'
import { RateLimiter, clientIp } from '../../http/request.ts'
import { CLIENT_ACTOR } from '../../shared/audit.ts'
import type { DB } from '../../shared/db.ts'
import { AppError, badRequest, notFound } from '../../shared/errors.ts'
import { DATE_RE } from '../../shared/time.ts'
import { cancelSchema, publicCreateSchema, rescheduleSchema } from '../appointments/appointments.schemas.ts'
import {
  assertClientCan,
  cancelAppointment,
  clientChangeRule,
  createAppointment,
  getAppointment,
  getByToken,
  rescheduleAppointment,
} from '../appointments/appointments.service.ts'
import { getAvailableDays, getAvailableSlots } from '../availability/availability.service.ts'
import { getSettings } from '../settings/settings.service.ts'
import { publicSupportSchema } from '../support/support.schemas.ts'
import { createSupportRequest } from '../support/support.service.ts'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function portalRoutes(db: DB) {
  const app = new Hono()
  // Límites por IP: reservas (10 / 15 min), cambios por enlace (30 / 15 min) y consultas de disponibilidad.
  const bookings = new RateLimiter(10, 15 * 60_000)
  const changes = new RateLimiter(30, 15 * 60_000)
  const lookups = new RateLimiter(240, 5 * 60_000)
  // Solicitudes de atención: pocas por IP (el formulario es público y escribe en la base de datos).
  const support = new RateLimiter(5, 60 * 60_000)

  const limit = (limiter: RateLimiter, ip: string) => {
    if (!limiter.hit(ip))
      throw new AppError(429, 'rate_limited', 'Demasiadas peticiones. Inténtalo de nuevo en unos minutos.')
  }

  // El portal puede desactivarse desde la configuración.
  app.use('*', async (c, next) => {
    if (c.req.path.endsWith('/info')) return next()
    if (!(await getSettings(db)).portal_enabled)
      throw new AppError(403, 'portal_disabled', 'Las reservas online no están disponibles en este momento.')
    return next()
  })

  app.get('/info', async (c) => {
    const s = await getSettings(db)
    return c.json({
      enabled: s.portal_enabled,
      businessName: s.business_name,
      address: s.address,
      phone: s.contact_phone,
      welcome: s.portal_welcome,
      timezone: s.timezone,
      durationMin: s.appointment_duration_min,
      maxAdvanceDays: s.max_advance_days,
      autoConfirm: s.auto_confirm,
      rules: {
        allowCancel: s.allow_client_cancel,
        allowReschedule: s.allow_client_reschedule,
        noticeHours: s.client_change_notice_hours,
      },
    })
  })

  /**
   * Solicitud de atención («No encuentro fecha», «Necesito atención urgente»). Solo queda REGISTRADA para que el
   * equipo la gestione: no se envía ningún mensaje ni se confirma contacto alguno. Respuesta idéntica si ya
   * existía una pendiente del mismo número (no se revela y no se duplica).
   */
  app.post('/support-requests', async (c) => {
    limit(support, clientIp(c))
    const input = await body(c, publicSupportSchema)
    await createSupportRequest(db, input, CLIENT_ACTOR(clientIp(c)))
    return c.json({ received: true }, 201)
  })

  /** Si se indica un token, se excluye esa cita de los conflictos (para reprogramar). */
  async function excludeIdFor(token: string | undefined): Promise<number | undefined> {
    if (!token) return undefined
    return (await getByToken(db, token))?.id
  }

  app.get('/availability/days', async (c) => {
    limit(lookups, clientIp(c))
    const month = c.req.query('month') ?? ''
    if (!MONTH_RE.test(month)) throw badRequest('Mes no válido (AAAA-MM).')
    const excludeId = await excludeIdFor(c.req.query('token'))
    return c.json({
      days: await getAvailableDays(db, month, { audience: 'public', ...(excludeId ? { excludeId } : {}) }),
    })
  })

  app.get('/availability/slots', async (c) => {
    limit(lookups, clientIp(c))
    const date = c.req.query('date') ?? ''
    if (!DATE_RE.test(date)) throw badRequest('Fecha no válida.')
    const excludeId = await excludeIdFor(c.req.query('token'))
    const slots = await getAvailableSlots(db, date, { audience: 'public', ...(excludeId ? { excludeId } : {}) })
    return c.json({ slots: slots.map(({ time, startsAt }) => ({ time, startsAt })) })
  })

  /** Vista pública de una cita: solo lo que el cliente necesita ver (sin notas internas). */
  async function publicView(token: string) {
    const row = await getByToken(db, token)
    if (!row) throw notFound('No hemos encontrado esa cita. Revisa que el enlace esté completo.')
    const s = await getSettings(db)
    const a = await getAppointment(db, row.id)
    return {
      token,
      status: a.status,
      date: a.date,
      time: a.time,
      endTime: a.endTime,
      startsAt: a.startsAt,
      reason: a.reason,
      cancelledBy: a.cancelledBy,
      customer: { fullName: a.customer.fullName, email: a.customer.email, phone: a.customer.phone },
      business: { name: s.business_name, address: s.address, phone: s.contact_phone, timezone: s.timezone },
      permissions: {
        cancel: clientChangeRule(s, row, 'cancel'),
        reschedule: clientChangeRule(s, row, 'reschedule'),
      },
    }
  }

  app.post('/appointments', async (c) => {
    const ip = clientIp(c)
    limit(bookings, ip)
    const input = await body(c, publicCreateSchema)
    const { website: _trap, ...data } = input
    const appt = await createAppointment(
      db,
      { ...data, internalNotes: '', status: 'pending' },
      { audience: 'public', actor: CLIENT_ACTOR(ip) }
    )
    return c.json({ appointment: await publicView(appt.publicToken) }, 201)
  })

  app.get('/appointments/:token', async (c) => {
    limit(changes, clientIp(c))
    return c.json({ appointment: await publicView(c.req.param('token')) })
  })

  app.post('/appointments/:token/cancel', async (c) => {
    const ip = clientIp(c)
    limit(changes, ip)
    const row = await getByToken(db, c.req.param('token'))
    if (!row) throw notFound('No hemos encontrado esa cita.')
    const { reason } = await body(c, cancelSchema)
    await assertClientCan(db, row, 'cancel')
    await cancelAppointment(db, row.id, 'client', reason, CLIENT_ACTOR(ip))
    return c.json({ appointment: await publicView(row.public_token) })
  })

  app.post('/appointments/:token/reschedule', async (c) => {
    const ip = clientIp(c)
    limit(changes, ip)
    const row = await getByToken(db, c.req.param('token'))
    if (!row) throw notFound('No hemos encontrado esa cita.')
    const slot = await body(c, rescheduleSchema)
    await assertClientCan(db, row, 'reschedule')
    await rescheduleAppointment(db, row.id, slot, { audience: 'public', actor: CLIENT_ACTOR(ip) })
    return c.json({ appointment: await publicView(row.public_token) })
  })

  return app
}
