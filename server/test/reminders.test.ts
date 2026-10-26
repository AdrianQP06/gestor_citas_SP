import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { createAppointment, cancelAppointment, rescheduleAppointment } from '../src/modules/appointments/appointments.service.ts'
import { SYSTEM_ACTOR } from '../src/shared/audit.ts'
import { all, get, run } from '../src/shared/db.ts'
import {
  MAX_ATTEMPTS,
  processDueNotifications,
  reconcileAllFuture,
  reconcileAppointment,
  retryNotification,
} from '../src/modules/notifications/notifications.service.ts'
import { getSettings, saveSettings } from '../src/modules/settings/settings.service.ts'
import { WhatsAppError } from '../src/integrations/whatsapp/whatsapp.provider.ts'
import { RecordingProvider, api, at, client, futureWorkday, login, setup } from './helpers.ts'

type N = { id: number; status: string; scheduled_for: string; attempts: number; last_error: string | null; recipient_id: number }
const rows = (t: Awaited<ReturnType<typeof setup>>) => all<N>(t.db, 'SELECT * FROM notifications ORDER BY id')
const utc = (dt: DateTime) => dt.toUTC()

async function withAppointment(opts: { recipients?: string[]; time?: string } = {}) {
  const provider = new RecordingProvider()
  const t = await setup({ provider })
  const admin = api(t, await login(t))
  for (const [i, phone] of (opts.recipients ?? ['+34600000001']).entries()) {
    assert.equal((await admin.post('/api/v1/whatsapp/recipients', { name: `Equipo ${i + 1}`, phone })).status, 201)
  }
  const date = futureWorkday()
  const time = opts.time ?? '10:00'
  const appt = await createAppointment(
    t.db,
    { date, time, ...client(), reason: 'Revisión de garantía', internalNotes: '', status: 'confirmed' },
    { audience: 'staff', actor: SYSTEM_ACTOR }
  )
  return { t, provider, admin, date, time, appt }
}

test('al crear una cita se programa un recordatorio por destinatario, 20 min antes', async () => {
  const { t, date, time } = await withAppointment({ recipients: ['+34600000001', '+34600000002'] })
  const list = (await rows(t))
  assert.equal(list.length, 2)
  const expected = utc(at(date, time).minus({ minutes: 20 })).toISO()
  assert.ok(list.every((n) => n.status === 'pending' && n.scheduled_for === expected))
})

test('se envía una sola vez, con nombre, hora local y motivo, y no se duplica', async () => {
  const { t, provider, date, time } = await withAppointment()
  const due = utc(at(date, time).minus({ minutes: 20 }))

  const early = await processDueNotifications(t.db, provider, due.minus({ minutes: 1 }))
  assert.equal(early.sent, 0, 'antes de la hora no se envía nada')
  assert.equal(provider.sent.length, 0)

  const first = await processDueNotifications(t.db, provider, due.plus({ seconds: 5 }))
  assert.equal(first.sent, 1)
  assert.deepEqual(provider.sent[0], {
    to: '+34600000001',
    clientName: 'Cliente Número 1',
    time: '10:00',
    reason: 'Revisión de garantía',
  })
  const sentRow = (await rows(t))[0]!
  assert.equal(sentRow.status, 'sent')
  assert.equal((await get<{ provider: string }>(t.db, 'SELECT provider FROM notifications'))!.provider, 'meta')

  // Ciclos posteriores y re-sincronizaciones no generan otro envío
  await processDueNotifications(t.db, provider, due.plus({ minutes: 1 }))
  await reconcileAppointment(t.db, 1)
  await reconcileAllFuture(t.db)
  await processDueNotifications(t.db, provider, due.plus({ minutes: 2 }))
  assert.equal(provider.sent.length, 1)
  assert.equal((await rows(t)).length, 1)
})

test('dos ejecuciones simultáneas del worker no envían dos veces (reclamo atómico)', async () => {
  const { t, provider, date, time } = await withAppointment()
  const now = utc(at(date, time).minus({ minutes: 19 }))
  const [a, b] = await Promise.all([
    processDueNotifications(t.db, provider, now),
    processDueNotifications(t.db, provider, now),
  ])
  assert.equal(a.sent + b.sent, 1)
  assert.equal(provider.sent.length, 1)
})

test('cancelar la cita cancela el recordatorio pendiente', async () => {
  const { t, provider, appt, date, time } = await withAppointment()
  await cancelAppointment(t.db, appt.id, 'staff', '', SYSTEM_ACTOR)
  assert.equal((await rows(t))[0]!.status, 'cancelled')
  const r = await processDueNotifications(t.db, provider, utc(at(date, time)).minus({ minutes: 10 }))
  assert.equal(r.sent, 0)
  assert.equal(provider.sent.length, 0)
})

test('reprogramar mueve el recordatorio a la nueva hora (y no queda el antiguo)', async () => {
  const { t, provider, appt, date } = await withAppointment()
  await rescheduleAppointment(t.db, appt.id, { date, time: '12:00' }, { audience: 'staff', actor: SYSTEM_ACTOR })
  const list = (await rows(t))
  assert.equal(list.length, 2)
  assert.equal(list[0]!.status, 'cancelled')
  assert.equal(list[1]!.status, 'pending')
  assert.equal(list[1]!.scheduled_for, utc(at(date, '12:00').minus({ minutes: 20 })).toISO())

  // A la hora del recordatorio original ya no se envía nada
  await processDueNotifications(t.db, provider, utc(at(date, '10:00').minus({ minutes: 19 })))
  assert.equal(provider.sent.length, 0)
  await processDueNotifications(t.db, provider, utc(at(date, '12:00').minus({ minutes: 19 })))
  assert.equal(provider.sent.length, 1)
  assert.equal(provider.sent[0]!.time, '12:00')

  // Volver a la hora original reactiva (no duplica) la fila antigua
  await rescheduleAppointment(t.db, appt.id, { date, time: '10:00' }, { audience: 'staff', actor: SYSTEM_ACTOR })
  assert.equal((await rows(t)).filter((n) => n.status === 'pending').length, 1)
})

test('reintentos con espera ante fallos temporales y fallo definitivo con registro', async () => {
  const { t, provider, date, time } = await withAppointment()
  const due = utc(at(date, time).minus({ minutes: 20 }))
  provider.failures = [new WhatsAppError('429 límite', true), new WhatsAppError('timeout', true)]

  const r1 = await processDueNotifications(t.db, provider, due)
  assert.equal(r1.retried, 1)
  let n = (await rows(t))[0]!
  assert.equal(n.status, 'pending')
  assert.equal(n.attempts, 1)
  assert.match(n.last_error!, /429/)

  // Aún en espera: no se reintenta
  assert.equal((await processDueNotifications(t.db, provider, due.plus({ seconds: 30 }))).retried, 0)
  // Pasada la espera, falla de nuevo y se reprograma
  assert.equal((await processDueNotifications(t.db, provider, due.plus({ minutes: 2 }))).retried, 1)
  // Tercer intento: éxito
  const r3 = await processDueNotifications(t.db, provider, due.plus({ minutes: 6 }))
  assert.equal(r3.sent, 1)
  n = (await rows(t))[0]!
  assert.equal(n.status, 'sent')
  assert.equal(n.last_error, null)
  assert.equal(provider.sent.length, 1)
})

test('un error no reintentable falla de inmediato, queda registrado y se puede reintentar a mano', async () => {
  const { t, provider, date, time } = await withAppointment()
  const due = utc(at(date, time).minus({ minutes: 20 }))
  provider.failures = [new WhatsAppError('Número no registrado', false)]
  const r = await processDueNotifications(t.db, provider, due)
  assert.equal(r.failed, 1)
  const n = (await rows(t))[0]!
  assert.equal(n.status, 'failed')
  assert.match(n.last_error!, /Número no registrado/)
  assert.ok(await get(t.db, "SELECT id FROM audit_log WHERE action = 'reminder.failed'"))

  // No se reintenta solo
  assert.equal((await processDueNotifications(t.db, provider, due.plus({ minutes: 5 }))).sent, 0)
  // Reintento manual
  assert.equal(await retryNotification(t.db, n.id, due.plus({ minutes: 6 })), true)
  const again = await processDueNotifications(t.db, provider, due.plus({ minutes: 6 }))
  assert.equal(again.sent, 1)
  assert.equal(await retryNotification(t.db, n.id, due.plus({ minutes: 7 })), false, 'una enviada no se reintenta')
})

test('se agotan los intentos tras MAX_ATTEMPTS fallos temporales', async () => {
  const { t, provider, date, time } = await withAppointment()
  let now = utc(at(date, time).minus({ minutes: 20 }))
  provider.failures = Array.from({ length: 10 }, () => new WhatsAppError('503', true))
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await processDueNotifications(t.db, provider, now)
    now = now.plus({ minutes: 4 })
  }
  const n = (await rows(t))[0]!
  assert.equal(n.status, 'failed')
  assert.equal(n.attempts, MAX_ATTEMPTS)
})

test('si la cita ya empezó el recordatorio caduca y no se envía', async () => {
  const { t, provider, date, time } = await withAppointment()
  const r = await processDueNotifications(t.db, provider, utc(at(date, time)).plus({ minutes: 1 }))
  assert.equal(r.sent, 0)
  assert.equal((await rows(t))[0]!.status, 'expired')
})

test('sin credenciales los recordatorios esperan en cola (no se marcan como fallidos)', async () => {
  const { t, provider, date, time } = await withAppointment()
  provider.configured = false
  const due = utc(at(date, time).minus({ minutes: 20 }))
  await processDueNotifications(t.db, provider, due)
  assert.equal((await rows(t))[0]!.status, 'pending')
  provider.configured = true
  assert.equal((await processDueNotifications(t.db, provider, due.plus({ minutes: 1 }))).sent, 1)
})

test('un envío "en curso" huérfano por una caída se recupera', async () => {
  const { t, provider, date, time } = await withAppointment()
  const due = utc(at(date, time).minus({ minutes: 20 }))
  await run(t.db, "UPDATE notifications SET status = 'sending', updated_at = $u", { u: due.minus({ minutes: 30 }).toISO()! })
  const r = await processDueNotifications(t.db, provider, due)
  assert.equal(r.sent, 1)
})

test('destinatarios: alta, baja y desactivación reprograman las citas futuras', async () => {
  const { t, admin } = await withAppointment()
  assert.equal((await rows(t)).length, 1)

  const added = await admin.post('/api/v1/whatsapp/recipients', { name: 'Otro', phone: '+34 600 000 002' })
  assert.equal(added.json.recipients.find((r: { name: string }) => r.name === 'Otro').phone, '+34600000002', 'normaliza a E.164')
  assert.equal((await rows(t)).length, 2)

  const otherId = added.json.recipients.find((r: { name: string }) => r.name === 'Otro').id
  await admin.patch(`/api/v1/whatsapp/recipients/${otherId}`, { name: 'Otro', phone: '+34600000002', active: false })
  assert.equal((await rows(t)).filter((n) => n.status === 'pending').length, 1)

  assert.equal((await admin.post('/api/v1/whatsapp/recipients', { name: 'Mal', phone: '600111222' })).status, 400)
  assert.equal((await admin.post('/api/v1/whatsapp/recipients', { name: 'Dup', phone: '+34600000002' })).status, 409)
})

test('el tiempo de antelación es configurable', async () => {
  const { t, appt, date, time } = await withAppointment()
  await saveSettings(t.db, { ...(await getSettings(t.db)), reminder_minutes: 45 })
  await reconcileAllFuture(t.db)
  const pending = (await rows(t)).filter((n) => n.status === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0]!.scheduled_for, utc(at(date, time).minus({ minutes: 45 })).toISO())
  assert.ok(appt.id)
})

test('una cita creada con menos de 20 min de margen se avisa de inmediato mientras no haya empezado', async () => {
  const provider = new RecordingProvider()
  const t = await setup({ provider })
  await api(t, await login(t)).post('/api/v1/whatsapp/recipients', { name: 'Eq', phone: '+34600000001' })
  const date = futureWorkday()
  await createAppointment(t.db, { date, time: '10:00', ...client(), internalNotes: '', status: 'confirmed' }, { audience: 'staff', actor: SYSTEM_ACTOR })
  // Simulamos que ahora son las 09:50 (10 min antes) y la fila se programó para las 09:40.
  const r = await processDueNotifications(t.db, provider, utc(at(date, '09:50')))
  assert.equal(r.sent, 1)
})

test('la API lista el registro de recordatorios y permite reintentar', async () => {
  const { t, provider, admin, date, time } = await withAppointment()
  provider.failures = [new WhatsAppError('Plantilla no encontrada', false)]
  await processDueNotifications(t.db, provider, utc(at(date, time).minus({ minutes: 20 })))
  const list = await admin.get('/api/v1/notifications?status=failed')
  assert.equal(list.json.total, 1)
  assert.equal(list.json.items[0].lastError, 'Plantilla no encontrada')
  assert.equal(list.json.items[0].clientName, 'Cliente Número 1')
  assert.equal((await admin.post(`/api/v1/notifications/${list.json.items[0].id}/retry`)).status, 200)
  assert.equal((await admin.post(`/api/v1/notifications/${list.json.items[0].id}/retry`)).status, 409)
})
