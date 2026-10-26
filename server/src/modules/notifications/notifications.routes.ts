import { Hono } from 'hono'
import { z } from 'zod'
import type { Config } from '../../config/env.ts'
import { body, intParam, intQuery, staffActor } from '../../http/helpers.ts'
import { describeProvider, WhatsAppError, type WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider.ts'
import { audit } from '../../shared/audit.ts'
import { all, get, run, type DB, type Params } from '../../shared/db.ts'
import { conflict, notFound } from '../../shared/errors.ts'
import { isoNow, localDateOf, localTimeOf, nowUtc } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { getSettings } from '../settings/settings.service.ts'
import { reconcileAllFuture, retryNotification } from './notifications.service.ts'

const e164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Usa el formato internacional, p. ej. +34600111222.'))

const recipientSchema = z.object({
  name: z.string().trim().min(2, 'Indica un nombre.').max(60),
  phone: e164,
  active: z.boolean().default(true),
})

type RecipientRow = { id: number; name: string; phone: string; active: number }

/** Destinatarios de WhatsApp y registro de recordatorios. Montado en /api/v1 (cada ruta declara su política). */
export function notificationRoutes(db: DB, config: Config, provider: WhatsAppProvider) {
  const app = new Hono<AuthVars>()
  const staff = requireAuth(db)
  const admin = requireAuth(db, 'admin')

  const recipients = async () =>
    (await all<RecipientRow>(db, 'SELECT id, name, phone, active FROM notification_recipients ORDER BY name, id')).map(
      (r) => ({ ...r, active: !!r.active })
    )

  app.get('/whatsapp/recipients', staff, async (c) =>
    c.json({ recipients: await recipients(), whatsapp: describeProvider(provider, config) })
  )

  app.post('/whatsapp/recipients', admin, async (c) => {
    const input = await body(c, recipientSchema)
    if (await get(db, 'SELECT id FROM notification_recipients WHERE phone = $p', { p: input.phone }))
      throw conflict('duplicate', 'Ese número ya está en la lista.')
    const info = await run(db, 'INSERT INTO notification_recipients (name, phone, active, created_at) VALUES ($n, $p, $a, $ts)', {
      n: input.name,
      p: input.phone,
      a: input.active ? 1 : 0,
      ts: isoNow(),
    })
    await reconcileAllFuture(db)
    await audit(db, staffActor(c), 'recipient.create', 'recipient', info.lastInsertRowid)
    return c.json({ recipients: await recipients() }, 201)
  })

  app.patch('/whatsapp/recipients/:id', admin, async (c) => {
    const id = intParam(c, 'id')
    const input = await body(c, recipientSchema)
    if (!(await get(db, 'SELECT id FROM notification_recipients WHERE id = $id', { id }))) throw notFound()
    if (await get(db, 'SELECT id FROM notification_recipients WHERE phone = $p AND id != $id', { p: input.phone, id }))
      throw conflict('duplicate', 'Ese número ya está en la lista.')
    await run(db, 'UPDATE notification_recipients SET name = $n, phone = $p, active = $a WHERE id = $id', {
      id,
      n: input.name,
      p: input.phone,
      a: input.active ? 1 : 0,
    })
    await reconcileAllFuture(db)
    await audit(db, staffActor(c), 'recipient.update', 'recipient', id)
    return c.json({ recipients: await recipients() })
  })

  app.delete('/whatsapp/recipients/:id', admin, async (c) => {
    const id = intParam(c, 'id')
    if (!(await run(db, 'DELETE FROM notification_recipients WHERE id = $id', { id })).changes) throw notFound()
    await audit(db, staffActor(c), 'recipient.delete', 'recipient', id)
    return c.json({ recipients: await recipients() })
  })

  app.post('/whatsapp/test', admin, async (c) => {
    const { recipientId } = await body(c, z.object({ recipientId: z.number().int().positive() }))
    const r = await get<RecipientRow>(db, 'SELECT * FROM notification_recipients WHERE id = $id', { id: recipientId })
    if (!r) throw notFound('El destinatario no existe.')
    const tz = (await getSettings(db)).timezone
    try {
      const result = await provider.send({
        to: r.phone,
        clientName: 'Mensaje de prueba',
        time: localTimeOf(nowUtc().toISO()!, tz),
        reason: 'Comprobación de la configuración de WhatsApp',
      })
      await audit(db, staffActor(c), 'whatsapp.test', 'recipient', r.id, { provider: result.provider })
      return c.json({ ok: true, provider: result.provider, messageId: result.messageId })
    } catch (err) {
      const message = (err as Error).message
      await audit(db, staffActor(c), 'whatsapp.test_failed', 'recipient', r.id, { error: message })
      return c.json(
        { error: { code: 'whatsapp_error', message }, retryable: err instanceof WhatsAppError ? err.retryable : true },
        502
      )
    }
  })

  // ------------------------------------------------------------ registro de recordatorios
  app.get('/notifications', staff, async (c) => {
    const tz = (await getSettings(db)).timezone
    const status = c.req.query('status')
    const page = intQuery(c, 'page', 1)
    const pageSize = intQuery(c, 'pageSize', 20, 1, 100)
    const filtered = !!status && /^[a-z]+$/.test(status)
    const where = filtered ? 'WHERE n.status = $status' : ''
    const params: Params = filtered ? { status: status! } : {}
    const total = Number(
      (await get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM notifications n ${where}`, params))!.n
    )
    const rows = await all<{
      id: number
      status: string
      scheduled_for: string
      attempts: number
      last_error: string | null
      provider: string | null
      sent_at: string | null
      appointment_id: number
      starts_at: string
      full_name: string
      recipient_name: string
      recipient_phone: string
    }>(
      db,
      `SELECT n.id, n.status, n.scheduled_for, n.attempts, n.last_error, n.provider, n.sent_at,
              a.id AS appointment_id, a.starts_at, c.full_name,
              r.name AS recipient_name, r.phone AS recipient_phone
       FROM notifications n
       JOIN appointments a ON a.id = n.appointment_id
       JOIN customers c ON c.id = a.customer_id
       JOIN notification_recipients r ON r.id = n.recipient_id
       ${where} ORDER BY n.scheduled_for DESC, n.id DESC LIMIT $limit OFFSET $offset`,
      { ...params, limit: pageSize, offset: (page - 1) * pageSize }
    )
    return c.json({
      total,
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        scheduledFor: r.scheduled_for,
        attempts: r.attempts,
        lastError: r.last_error,
        provider: r.provider,
        sentAt: r.sent_at,
        appointmentId: r.appointment_id,
        appointmentDate: localDateOf(r.starts_at, tz),
        appointmentTime: localTimeOf(r.starts_at, tz),
        clientName: r.full_name,
        recipientName: r.recipient_name,
        recipientPhone: r.recipient_phone,
      })),
    })
  })

  app.post('/notifications/:id/retry', staff, async (c) => {
    const id = intParam(c, 'id')
    if (!(await retryNotification(db, id)))
      throw conflict('invalid_state', 'Solo se pueden reintentar recordatorios fallidos de citas futuras.')
    await audit(db, staffActor(c), 'notification.retry', 'notification', id)
    return c.json({ ok: true })
  })

  return app
}
