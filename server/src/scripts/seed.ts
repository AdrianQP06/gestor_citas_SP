/**
 * Datos de demostración. Idempotente: si ya hay usuarios no hace nada (usa --force para reiniciar).
 *   npm run seed            → crea admin + personal + horario + citas de ejemplo
 *   npm run seed -- --force → borra todos los datos y vuelve a crear la demo
 */
import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { dbOptions } from '../config/database.ts'
import { loadConfig } from '../config/env.ts'
import { createAppointment } from '../modules/appointments/appointments.service.ts'
import { getCandidates } from '../modules/availability/availability.service.ts'
import { hashPassword } from '../modules/auth/auth.service.ts'
import { reconcileAllFuture } from '../modules/notifications/notifications.service.ts'
import { DEFAULT_SETTINGS, saveException, saveSettings, saveWeek } from '../modules/settings/settings.service.ts'
import { SYSTEM_ACTOR } from '../shared/audit.ts'
import { closeDb, get, migrate, openDb, run } from '../shared/db.ts'
import { configureLogger } from '../shared/logger.ts'
import { addDays, isoNow, isoWeekday, nowUtc, todayLocal } from '../shared/time.ts'

const config = loadConfig()
configureLogger({ silent: true })
const db = openDb(dbOptions(config))

try {
  await migrate(db)

  if (process.argv.includes('--force')) {
    for (const t of [
      'notifications',
      'appointments',
      'customers',
      'notification_recipients',
      'blocks',
      'exceptions',
      'working_hours',
      'settings',
      'sessions',
      'audit_log',
      'users',
    ]) {
      await run(db, `DELETE FROM ${t}`)
    }
  }

  if (Number((await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users'))!.n) > 0) {
    console.log('La base de datos ya tiene datos. Usa `npm run seed -- --force` para reiniciarla.')
  } else {
    await seed()
  }
} finally {
  await closeDb(db)
}

function randomPassword(): string {
  return randomBytes(12).toString('base64url')
}

async function seed() {
  // --- usuarios (contraseñas aleatorias: no hay credenciales fijas en el código)
  const adminPassword = config.SEED_ADMIN_PASSWORD ?? randomPassword()
  const staffPassword = randomPassword()
  const users = [
    { email: config.SEED_ADMIN_EMAIL, name: 'Laura Martín', role: 'admin', password: adminPassword },
    { email: 'equipo@demo.local', name: 'Carlos Ruiz', role: 'staff', password: staffPassword },
  ]
  for (const u of users) {
    await run(db, 'INSERT INTO users (email, name, password_hash, role, created_at) VALUES ($e, $n, $h, $r, $ts)', {
      ts: isoNow(),
      e: u.email,
      n: u.name,
      h: await hashPassword(u.password),
      r: u.role,
    })
  }

  // --- configuración y horario
  const settings = await saveSettings(db, {
    ...DEFAULT_SETTINGS,
    business_name: 'Supernova',
    timezone: 'Europe/Madrid',
  })
  const weekday = { enabled: true, open_time: '09:00', close_time: '18:00', break_start: '14:00', break_end: '15:00' }
  await saveWeek(
    db,
    [1, 2, 3, 4, 5, 6, 7].map((d) =>
      d <= 5
        ? { weekday: d, ...weekday }
        : d === 6
          ? { weekday: d, enabled: true, open_time: '10:00', close_time: '13:00', break_start: null, break_end: null }
          : { weekday: d, enabled: false, open_time: '09:00', close_time: '18:00', break_start: null, break_end: null }
    )
  )

  const today = todayLocal(settings.timezone)
  // Un festivo de ejemplo dentro de ~3 semanas (si cae en día laborable).
  let holiday = addDays(today, 21)
  if (isoWeekday(holiday) >= 6) holiday = addDays(holiday, 2)
  await saveException(db, { date: holiday, closed: true, label: 'Festivo local' })

  await run(db, 'INSERT INTO notification_recipients (name, phone, active, created_at) VALUES ($n, $p, 1, $ts)', {
    ts: isoNow(),
    n: 'Recepción',
    p: '+34600000001',
  })

  // --- citas de ejemplo (reproducibles)
  let seed = 7
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!

  const people = [
    'Marta Gómez', 'Javier Ortega', 'Lucía Fernández', 'Pablo Navarro', 'Elena Castillo', 'Andrés Molina',
    'Sofía Herrera', 'Diego Ramos', 'Carmen Vidal', 'Rubén Serrano', 'Irene Prieto', 'Álvaro Cano',
    'Natalia Soto', 'Hugo Iglesias', 'Paula Marín', 'Adrián Peña', 'Claudia Rojas', 'Sergio Lozano',
  ]
  const reasons = [
    'Primera consulta', 'Revisión general', 'Seguimiento', 'Presupuesto', 'Asesoramiento personalizado',
    'Entrega de documentación', 'Cambio de plan', 'Consulta rápida',
  ]
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.')

  let created = 0
  for (let offset = -9; offset <= 13; offset++) {
    const date = addDays(today, offset)
    // Para poder crear citas pasadas, validamos con un "ahora" anterior a ese día.
    const asOf = DateTime.fromISO(date, { zone: settings.timezone }).minus({ days: 2 }).toUTC()
    const slots = (await getCandidates(db, date, { audience: 'staff', now: asOf, settings })).filter((c) => c.available)
    const wanted = Math.min(slots.length, Math.floor(rnd() * 5) + (offset >= 0 && offset <= 4 ? 3 : 1))
    for (let i = 0; i < wanted; i++) {
      const free = (await getCandidates(db, date, { audience: 'staff', now: asOf, settings })).filter((c) => c.available)
      if (!free.length) break
      const slot = pick(free)
      const name = pick(people)
      const appt = await createAppointment(
        db,
        {
          date,
          time: slot.time,
          fullName: name,
          phone: `+346${String(10000000 + Math.floor(rnd() * 89999999))}`,
          email: `${slug(name)}@example.com`,
          reason: pick(reasons),
          internalNotes: rnd() < 0.2 ? 'Cliente habitual. Prefiere trato por teléfono.' : '',
          status: 'confirmed',
        },
        { audience: 'staff', actor: SYSTEM_ACTOR, now: asOf }
      )
      created++
      const isPast = offset < 0 || (offset === 0 && appt.startsAt < nowUtc().toISO()!)
      const roll = rnd()
      if (isPast) {
        const status = roll < 0.75 ? 'completed' : 'cancelled'
        await run(db, 'UPDATE appointments SET status = $s, cancelled_by = $c WHERE id = $id', {
          s: status,
          c: status === 'cancelled' ? 'client' : null,
          id: appt.id,
        })
      } else if (roll < 0.28) {
        await run(db, "UPDATE appointments SET status = 'pending', source = 'portal' WHERE id = $id", { id: appt.id })
      } else if (roll < 0.36) {
        await run(db, "UPDATE appointments SET status = 'cancelled', cancelled_by = 'client' WHERE id = $id", { id: appt.id })
      }
    }
  }
  await reconcileAllFuture(db)

  console.log(`Datos de demostración creados (${created} citas).`)
  console.log(`  Administrador: ${config.SEED_ADMIN_EMAIL}  /  ${adminPassword}`)
  console.log(`  Personal:      equipo@demo.local  /  ${staffPassword}`)
  console.log('  (Anota estas contraseñas ahora: no se vuelven a mostrar. Son solo de demostración.)')
}
