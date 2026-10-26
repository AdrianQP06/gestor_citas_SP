import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import {
  createAppointment,
  getAppointment,
  rescheduleAppointment,
} from '../src/modules/appointments/appointments.service.ts'
import { SYSTEM_ACTOR } from '../src/shared/audit.ts'
import { all, closeDb, get, run } from '../src/shared/db.ts'
import { saveSettings, getSettings, saveException } from '../src/modules/settings/settings.service.ts'
import { api, client, futureWorkday, login, openTestDb, setup } from './helpers.ts'

test('flujo público completo: reservar, ver, reprogramar y cancelar', async () => {
  const t = await setup()
  const date = futureWorkday()
  const pub = api(t)

  const days = await pub.get(`/api/v1/public/availability/days?month=${date.slice(0, 7)}`)
  assert.equal(days.status, 200)
  assert.ok(days.json.days.some((d: { date: string }) => d.date === date))

  const slots = await pub.get(`/api/v1/public/availability/slots?date=${date}`)
  assert.ok(slots.json.slots.some((s: { time: string }) => s.time === '10:00'))

  const created = await pub.post('/api/v1/public/appointments', { date, time: '10:00', ...client() })
  assert.equal(created.status, 201)
  const appt = created.json.appointment
  assert.equal(appt.status, 'pending', 'sin confirmación automática queda pendiente')
  assert.equal(appt.time, '10:00')
  assert.equal(appt.internalNotes, undefined, 'la vista pública no expone notas internas')
  assert.ok(appt.token.length >= 30)

  // El horario ya no se ofrece y reservarlo de nuevo falla
  const after = await pub.get(`/api/v1/public/availability/slots?date=${date}`)
  assert.ok(!after.json.slots.some((s: { time: string }) => s.time === '10:00'))
  const dup = await pub.post('/api/v1/public/appointments', { date, time: '10:00', ...client(2) })
  assert.equal(dup.status, 409)
  assert.equal(dup.json.error.code, 'slot_unavailable')

  // Consultar por enlace
  const got = await pub.get(`/api/v1/public/appointments/${appt.token}`)
  assert.equal(got.json.appointment.permissions.cancel.allowed, true)
  assert.equal((await pub.get('/api/v1/public/appointments/token-inventado')).status, 404)

  // Reprogramar (al cambiar, su propio horario no cuenta como ocupado)
  const same = await pub.post(`/api/v1/public/appointments/${appt.token}/reschedule`, { date, time: '10:00' })
  assert.equal(same.status, 200)
  const moved = await pub.post(`/api/v1/public/appointments/${appt.token}/reschedule`, { date, time: '11:00' })
  assert.equal(moved.json.appointment.time, '11:00')
  const freed = await pub.get(`/api/v1/public/availability/slots?date=${date}`)
  assert.ok(freed.json.slots.some((s: { time: string }) => s.time === '10:00'), 'el horario antiguo se libera')

  // Cancelar libera el hueco
  const cancelled = await pub.post(`/api/v1/public/appointments/${appt.token}/cancel`, { reason: 'Imprevisto' })
  assert.equal(cancelled.json.appointment.status, 'cancelled')
  const again = await pub.post(`/api/v1/public/appointments/${appt.token}/cancel`, {})
  assert.equal(again.status, 403)
  const rebook = await pub.post('/api/v1/public/appointments', { date, time: '11:00', ...client(3) })
  assert.equal(rebook.status, 201)
})

test('la validación del servidor rechaza datos incorrectos y el campo trampa', async () => {
  const t = await setup()
  const date = futureWorkday()
  const pub = api(t)
  const bad = await pub.post('/api/v1/public/appointments', { date, time: '10:00', fullName: 'A', phone: '12', email: 'no', reason: '' })
  assert.equal(bad.status, 400)
  assert.ok(bad.json.error.fields.fullName && bad.json.error.fields.phone && bad.json.error.fields.email)
  const bot = await pub.post('/api/v1/public/appointments', { date, time: '10:00', ...client(), website: 'http://spam' })
  assert.equal(bot.status, 400)
  const offHours = await pub.post('/api/v1/public/appointments', { date, time: '14:00', ...client() })
  assert.equal(offHours.status, 409, 'durante el descanso no se puede reservar')
  const night = await pub.post('/api/v1/public/appointments', { date, time: '22:00', ...client() })
  assert.equal(night.status, 409)
  const closedDay = futureWorkday(10)
  await saveException(t.db, { date: closedDay, closed: true, label: 'Festivo' })
  assert.equal((await pub.post('/api/v1/public/appointments', { date: closedDay, time: '10:00', ...client() })).status, 409)
})

test('antelación mínima: el portal rechaza reservas demasiado próximas', async () => {
  const t = await setup()
  await saveSettings(t.db, { ...(await getSettings(t.db)), min_notice_min: 60 * 24 * 14 })
  const res = await api(t).post('/api/v1/public/appointments', { date: futureWorkday(3), time: '10:00', ...client() })
  assert.equal(res.status, 409)
  assert.equal(res.json.error.code, 'slot_unavailable')
})

test('máximo de citas próximas por correo desde el portal', async () => {
  const t = await setup()
  const date = futureWorkday()
  const pub = api(t)
  for (const time of ['09:00', '09:30', '10:00']) {
    assert.equal((await pub.post('/api/v1/public/appointments', { date, time, ...client() })).status, 201)
  }
  const fourth = await pub.post('/api/v1/public/appointments', { date, time: '10:30', ...client() })
  assert.equal(fourth.status, 409)
  assert.equal(fourth.json.error.code, 'too_many_upcoming')
})

test('reglas de cancelación/reprogramación del cliente', async () => {
  const t = await setup()
  const pub = api(t)
  // Cita en 5 horas desde ahora no se puede crear fácilmente en horario laboral; se inserta vía servicio con "ahora" simulado.
  const date = futureWorkday()
  const staffCreated = await createAppointment(
    t.db,
    { date, time: '10:00', ...client(), internalNotes: 'nota', status: 'confirmed' },
    { audience: 'staff', actor: SYSTEM_ACTOR }
  )
  // Dentro del plazo (mínimo 24 h): permitido
  const ok = await pub.get(`/api/v1/public/appointments/${staffCreated.publicToken}`)
  assert.equal(ok.json.appointment.permissions.cancel.allowed, true)

  // Forzamos que la cita esté a menos de 24 h
  const soon = DateTime.utc().plus({ hours: 5 })
  await run(t.db, 'UPDATE appointments SET starts_at = $s, ends_at = $e WHERE id = $id', {
    s: soon.toISO()!,
    e: soon.plus({ minutes: 30 }).toISO()!,
    id: staffCreated.id,
  })
  const blocked = await pub.post(`/api/v1/public/appointments/${staffCreated.publicToken}/cancel`, {})
  assert.equal(blocked.status, 403)
  assert.match(blocked.json.error.message, /24 h/)

  // Cancelación desactivada en la configuración
  await run(t.db, 'UPDATE appointments SET starts_at = $s, ends_at = $e WHERE id = $id', {
    s: DateTime.utc().plus({ days: 5 }).toISO()!,
    e: DateTime.utc().plus({ days: 5, minutes: 30 }).toISO()!,
    id: staffCreated.id,
  })
  await saveSettings(t.db, { ...(await getSettings(t.db)), allow_client_cancel: false })
  assert.equal((await pub.post(`/api/v1/public/appointments/${staffCreated.publicToken}/cancel`, {})).status, 403)
})

test('reprogramar desde el portal devuelve una cita confirmada a pendiente', async () => {
  const t = await setup()
  const date = futureWorkday()
  const staff = await createAppointment(
    t.db,
    { date, time: '10:00', ...client(), internalNotes: '', status: 'confirmed' },
    { audience: 'staff', actor: SYSTEM_ACTOR }
  )
  const res = await api(t).post(`/api/v1/public/appointments/${staff.publicToken}/reschedule`, { date, time: '12:00' })
  assert.equal(res.json.appointment.status, 'pending')
})

test('portal desactivado', async () => {
  const t = await setup()
  await saveSettings(t.db, { ...(await getSettings(t.db)), portal_enabled: false })
  assert.equal((await api(t).get('/api/v1/public/info')).json.enabled, false)
  assert.equal((await api(t).get('/api/v1/public/availability/slots?date=2030-01-01')).status, 403)
})

test('el personal gestiona citas: crear, editar, confirmar, reprogramar, completar y cancelar', async () => {
  const t = await setup()
  const cookie = await login(t, 'staff@test.local')
  const staff = api(t, cookie)
  const date = futureWorkday()

  const created = await staff.post('/api/v1/appointments', {
    date, time: '09:00', ...client(), internalNotes: 'Alérgico al látex', status: 'pending',
  })
  assert.equal(created.status, 201)
  const id = created.json.appointment.id
  assert.equal(created.json.appointment.internalNotes, 'Alérgico al látex')

  // Solapamiento desde el panel
  const overlap = await staff.post('/api/v1/appointments', { date, time: '09:00', ...client(2), status: 'confirmed' })
  assert.equal(overlap.status, 409)

  const patched = await staff.patch(`/api/v1/appointments/${id}`, { reason: 'Revisión + analítica', internalNotes: 'Nota nueva' })
  assert.equal(patched.json.appointment.reason, 'Revisión + analítica')

  assert.equal((await staff.post(`/api/v1/appointments/${id}/confirm`)).json.appointment.status, 'confirmed')
  assert.equal((await staff.post(`/api/v1/appointments/${id}/confirm`)).status, 409, 'solo las pendientes se confirman')

  const moved = await staff.post(`/api/v1/appointments/${id}/reschedule`, { date, time: '16:00' })
  assert.equal(moved.json.appointment.time, '16:00')
  assert.equal(moved.json.appointment.status, 'confirmed', 'el personal no cambia el estado al reprogramar')

  const list = await staff.get(`/api/v1/appointments?q=cliente&status=confirmed`)
  assert.equal(list.json.total, 1)

  assert.equal((await staff.post(`/api/v1/appointments/${id}/complete`)).status, 409, 'aún no ha empezado')
  const cancelled = await staff.post(`/api/v1/appointments/${id}/cancel`, { reason: 'No puede asistir' })
  assert.equal(cancelled.json.appointment.status, 'cancelled')
  assert.equal(cancelled.json.appointment.cancelledBy, 'staff')

  // El cliente quedó registrado una vez
  const customers = await staff.get('/api/v1/customers')
  assert.equal(customers.json.total, 1)
  const detail = await staff.get(`/api/v1/customers/${customers.json.items[0].id}`)
  assert.equal(detail.json.appointments.length, 1)

  const audit = await all(t.db, "SELECT action FROM audit_log WHERE entity = 'appointment' ORDER BY id")
  assert.deepEqual(
    audit.map((a) => a.action),
    ['appointment.create', 'appointment.update', 'appointment.confirm', 'appointment.reschedule', 'appointment.cancel']
  )
})

test('dos reservas simultáneas del mismo horario, desde conexiones independientes, solo prospera una', async () => {
  const t = await setup()
  const second = openTestDb() // otro pool = otra "instancia" de la aplicación
  try {
    const date = futureWorkday()
    const input = (n: number) => ({ date, time: '10:00', ...client(n), internalNotes: '', status: 'confirmed' as const })
    const attempts = await Promise.allSettled([
      createAppointment(t.db, input(1), { audience: 'staff', actor: SYSTEM_ACTOR }),
      createAppointment(second, input(2), { audience: 'staff', actor: SYSTEM_ACTOR }),
      createAppointment(t.db, input(3), { audience: 'staff', actor: SYSTEM_ACTOR }),
      createAppointment(second, input(4), { audience: 'staff', actor: SYSTEM_ACTOR }),
    ])
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1)
    for (const a of attempts) {
      if (a.status === 'rejected') assert.equal((a.reason as { status?: number }).status, 409)
    }
    assert.equal(Number((await get<{ n: number }>(second, 'SELECT COUNT(*) AS n FROM appointments'))!.n), 1)

    // Solapamiento parcial (no es un duplicado exacto): con citas de 60 min, 10:30 choca con 10:00.
    await saveSettings(t.db, { ...(await getSettings(t.db)), appointment_duration_min: 60 })
    await assert.rejects(
      createAppointment(second, { ...input(5), time: '10:30' }, { audience: 'staff', actor: SYSTEM_ACTOR }),
      (e: Error & { status?: number }) => e.status === 409
    )
    assert.equal(Number((await get<{ n: number }>(second, 'SELECT COUNT(*) AS n FROM appointments'))!.n), 1)
  } finally {
    await closeDb(second)
  }
})

test('dos cambios simultáneos de horario hacia el mismo hueco: solo uno se aplica', async () => {
  const t = await setup()
  const date = futureWorkday()
  const mk = (n: number, time: string) =>
    createAppointment(t.db, { date, time, ...client(n), internalNotes: '', status: 'confirmed' }, { audience: 'staff', actor: SYSTEM_ACTOR })
  const a = await mk(1, '09:00')
  const b = await mk(2, '09:30')
  const results = await Promise.allSettled([
    rescheduleAppointment(t.db, a.id, { date, time: '12:00' }, { audience: 'staff', actor: SYSTEM_ACTOR }),
    rescheduleAppointment(t.db, b.id, { date, time: '12:00' }, { audience: 'staff', actor: SYSTEM_ACTOR }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const [after1, after2] = [await getAppointment(t.db, a.id), await getAppointment(t.db, b.id)]
  assert.notEqual(after1.startsAt, after2.startsAt, 'las dos citas no pueden acabar en el mismo horario')
})
