import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'
import { createAppointment } from '../src/modules/appointments/appointments.service.ts'
import { getAvailableSlots, getCandidates } from '../src/modules/availability/availability.service.ts'
import { createBlock, getSettings, saveException, saveSettings } from '../src/modules/settings/settings.service.ts'
import { SYSTEM_ACTOR } from '../src/shared/audit.ts'
import { localToUtcIso, minutes } from '../src/shared/time.ts'
import { TZ, client, futureWorkday, setup } from './helpers.ts'

const times = (slots: { time: string }[]) => slots.map((s) => s.time)

test('la rejilla respeta apertura, cierre y descanso', async () => {
  const { db } = await setup()
  const date = futureWorkday()
  const slots = times(await getAvailableSlots(db, date, { audience: 'staff' }))
  assert.equal(slots[0], '09:00')
  assert.equal(slots.at(-1), '17:30')
  assert.ok(!slots.includes('14:00') && !slots.includes('14:30'), 'no hay citas durante el descanso')
  assert.ok(slots.includes('13:30') && slots.includes('15:00'))
  assert.equal(slots.length, 16) // 9:00-14:00 (10) + 15:00-18:00 (6)
})

test('días cerrados, festivos y horario especial', async () => {
  const { db } = await setup()
  const date = futureWorkday()
  await saveException(db, { date, closed: true, label: 'Festivo' })
  assert.deepEqual(await getAvailableSlots(db, date, { audience: 'staff' }), [])
  await saveException(db, { date, closed: false, open_time: '10:00', close_time: '12:00', label: 'Horario reducido' })
  assert.deepEqual(times(await getAvailableSlots(db, date, { audience: 'staff' })), ['10:00', '10:30', '11:00', '11:30'])
})

test('un bloqueo manual quita los horarios que toca', async () => {
  const { db } = await setup()
  const date = futureWorkday()
  await createBlock(db, { date, start_time: '10:00', end_time: '11:00', reason: 'Formación' }, TZ)
  const slots = times(await getAvailableSlots(db, date, { audience: 'staff' }))
  assert.ok(!slots.includes('10:00') && !slots.includes('10:30'))
  assert.ok(slots.includes('09:30') && slots.includes('11:00'))
})

test('el intervalo entre citas amplía la rejilla y el margen de las ocupadas', async () => {
  const { db } = await setup()
  await saveSettings(db, { ...(await getSettings(db)), buffer_min: 15 })
  const date = futureWorkday()
  const slots = times(await getAvailableSlots(db, date, { audience: 'staff' }))
  assert.deepEqual(slots.slice(0, 3), ['09:00', '09:45', '10:30']) // 30 min + 15 min de margen
  await createAppointment(
    db,
    { date, time: '09:45', ...client(), internalNotes: '', status: 'confirmed' },
    { audience: 'staff', actor: SYSTEM_ACTOR }
  )
  assert.ok(slots.includes('09:00'), 'con margen exacto de 15 min, la cita anterior sigue siendo posible')
  // Si el margen aumenta después, las citas existentes lo imponen a sus vecinas.
  await saveSettings(db, { ...(await getSettings(db)), buffer_min: 30 })
  const after = times(await getAvailableSlots(db, date, { audience: 'staff' })) // rejilla de 60 min
  assert.deepEqual(after.slice(0, 4), ['11:00', '12:00', '13:00', '15:00'])
})

test('antelación mínima y antelación máxima solo aplican al portal público', async () => {
  const { db } = await setup()
  const now = DateTime.fromISO('2030-03-04T08:00:00', { zone: TZ }).toUTC() // lunes 08:00
  const date = '2030-03-04'
  const pub = times(await getAvailableSlots(db, date, { audience: 'public', now }))
  assert.equal(pub[0], '10:00', 'requiere 2 h de antelación (min_notice_min = 120)')
  const staff = times(await getAvailableSlots(db, date, { audience: 'staff', now }))
  assert.equal(staff[0], '09:00')

  const tooFar = await getCandidates(db, '2030-07-15', { audience: 'public', now }) // > 60 días
  assert.ok(tooFar.length > 0 && tooFar.every((c) => !c.available && c.reason === 'too_far'))
  assert.ok((await getCandidates(db, '2030-07-15', { audience: 'staff', now })).some((c) => c.available))
})

test('no se ofrecen horarios pasados', async () => {
  const { db } = await setup()
  const now = DateTime.fromISO('2030-03-04T12:10:00', { zone: TZ }).toUTC()
  const slots = times(await getAvailableSlots(db, '2030-03-04', { audience: 'staff', now }))
  assert.equal(slots[0], '12:30')
})

test('zona horaria: conversión local → UTC con horario de verano e inexistentes', () => {
  assert.equal(localToUtcIso('2030-01-15', '10:00', 'Europe/Madrid'), '2030-01-15T09:00:00.000Z') // CET
  assert.equal(localToUtcIso('2030-07-15', '10:00', 'Europe/Madrid'), '2030-07-15T08:00:00.000Z') // CEST
  assert.equal(localToUtcIso('2030-03-31', '02:30', 'Europe/Madrid'), null, 'hora inexistente por cambio de hora')
  assert.equal(localToUtcIso('2030-07-15', '10:00', 'America/Mexico_City'), '2030-07-15T16:00:00.000Z')
  assert.equal(minutes('09:30'), 570)
})
