import { Hono } from 'hono'
import type { Config } from '../../config/env.ts'
import { intParam, readJson, staffActor } from '../../http/helpers.ts'
import { describeProvider, type WhatsAppProvider } from '../../integrations/whatsapp/whatsapp.provider.ts'
import { audit } from '../../shared/audit.ts'
import { get, type DB } from '../../shared/db.ts'
import { badRequest, notFound } from '../../shared/errors.ts'
import { DATE_RE, dayBoundsUtc, localDateOf, localTimeOf, nowUtc } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { reconcileAllFuture } from '../notifications/notifications.service.ts'
import {
  createBlock,
  deleteBlock,
  deleteException,
  getSettings,
  getWeek,
  listBlocks,
  listExceptions,
  saveException,
  saveSettings,
  saveWeek,
  settingsSchema,
} from './settings.service.ts'

async function countActiveAppointments(db: DB, fromIso: string, toIso: string): Promise<number> {
  const row = await get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM appointments WHERE status IN ('pending','confirmed') AND starts_at < $to AND ends_at > $from",
    { from: fromIso, to: toIso }
  )
  return Number(row!.n)
}

/**
 * Configuración del negocio. Montado en /api/v1/settings.
 * Lectura: cualquier usuario autenticado. Escritura: administradores (salvo los bloqueos manuales).
 */
export function settingsRoutes(db: DB, config: Config, provider: WhatsAppProvider) {
  const app = new Hono<AuthVars>()
  const staff = requireAuth(db)
  const admin = requireAuth(db, 'admin')

  app.get('/', staff, async (c) =>
    c.json({
      settings: await getSettings(db),
      week: await getWeek(db),
      whatsapp: describeProvider(provider, config),
      portalUrl: `${config.APP_URL.replace(/\/$/, '')}/reservar`,
    })
  )

  app.put('/', admin, async (c) => {
    const input = settingsSchema.parse(await readJson(c))
    const before = await getSettings(db)
    const saved = await saveSettings(db, input)
    if (before.reminder_minutes !== saved.reminder_minutes) await reconcileAllFuture(db)
    await audit(db, staffActor(c), 'settings.update', 'settings', null)
    return c.json({ settings: saved })
  })

  app.put('/week', admin, async (c) => {
    const week = await saveWeek(db, await readJson(c))
    await audit(db, staffActor(c), 'settings.week_update', 'settings', null)
    return c.json({ week })
  })

  // ------------------------------------------------------------ excepciones por fecha
  app.get('/exceptions', staff, async (c) => {
    const today = localDateOf(nowUtc().toISO()!, (await getSettings(db)).timezone)
    return c.json({ exceptions: await listExceptions(db, today) })
  })

  app.put('/exceptions', admin, async (c) => {
    const saved = await saveException(db, await readJson(c))
    const { start, end } = dayBoundsUtc(saved.date, (await getSettings(db)).timezone)
    const affected = saved.closed ? await countActiveAppointments(db, start, end) : 0
    await audit(db, staffActor(c), 'exception.save', 'exception', saved.date, { closed: saved.closed })
    return c.json({ exception: saved, affectedAppointments: affected })
  })

  app.delete('/exceptions/:date', admin, async (c) => {
    const date = c.req.param('date')
    if (!DATE_RE.test(date)) throw badRequest('Fecha no válida.')
    if (!(await deleteException(db, date))) throw notFound('La excepción no existe.')
    await audit(db, staffActor(c), 'exception.delete', 'exception', date)
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ bloqueos manuales
  app.get('/blocks', staff, async (c) => {
    const tz = (await getSettings(db)).timezone
    const blocks = (await listBlocks(db, nowUtc().toISO()!)).map((b) => ({
      id: b.id,
      reason: b.reason,
      date: localDateOf(b.starts_at, tz),
      startTime: localTimeOf(b.starts_at, tz),
      endTime: localTimeOf(b.ends_at, tz),
    }))
    return c.json({ blocks })
  })

  app.post('/blocks', staff, async (c) => {
    const block = await createBlock(db, await readJson(c), (await getSettings(db)).timezone)
    const affected = await countActiveAppointments(db, block.starts_at, block.ends_at)
    await audit(db, staffActor(c), 'block.create', 'block', block.id, { start: block.starts_at, end: block.ends_at })
    return c.json({ block, affectedAppointments: affected }, 201)
  })

  app.delete('/blocks/:id', staff, async (c) => {
    const id = intParam(c, 'id')
    if (!(await deleteBlock(db, id))) throw notFound('El bloqueo no existe.')
    await audit(db, staffActor(c), 'block.delete', 'block', id)
    return c.json({ ok: true })
  })

  return app
}
