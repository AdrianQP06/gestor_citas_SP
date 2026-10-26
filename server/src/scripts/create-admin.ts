/**
 * Crea el primer administrador en un entorno real (sin datos de demostración).
 *   ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin -w server
 * También deja listos los valores iniciales (configuración y horario L-V 09:00-18:00) si la base de datos está vacía.
 * Es seguro repetirlo: si el correo ya existe, no hace nada.
 */
import { dbOptions } from '../config/database.ts'
import { loadConfig } from '../config/env.ts'
import { passwordSchema } from '../modules/auth/auth.schemas.ts'
import { hashPassword } from '../modules/auth/auth.service.ts'
import { DEFAULT_SETTINGS, saveSettings, saveWeek } from '../modules/settings/settings.service.ts'
import { closeDb, get, migrate, openDb, run } from '../shared/db.ts'
import { configureLogger } from '../shared/logger.ts'
import { isoNow } from '../shared/time.ts'

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const name = process.env.ADMIN_NAME?.trim()
const password = process.env.ADMIN_PASSWORD

if (!email || !name || !password) {
  console.error('Faltan ADMIN_EMAIL, ADMIN_NAME o ADMIN_PASSWORD.')
  process.exit(1)
}
const check = passwordSchema.safeParse(password)
if (!check.success) {
  console.error(check.error.issues.map((i) => i.message).join(' '))
  process.exit(1)
}

configureLogger({ silent: true })
const db = openDb(dbOptions(loadConfig()))
try {
  await migrate(db)
  if (await get(db, 'SELECT id FROM users WHERE email = $e', { e: email })) {
    console.log(`El usuario ${email} ya existe. No se ha cambiado nada.`)
  } else {
    await run(db, "INSERT INTO users (email, name, password_hash, role, created_at) VALUES ($e, $n, $h, 'admin', $ts)", {
      ts: isoNow(),
      e: email,
      n: name,
      h: await hashPassword(password),
    })
    if (!(await get(db, 'SELECT id FROM settings WHERE id = 1'))) await saveSettings(db, { ...DEFAULT_SETTINGS })
    if (Number((await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM working_hours'))!.n) === 0) {
      await saveWeek(
        db,
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          enabled: weekday <= 5,
          open_time: '09:00',
          close_time: '18:00',
          break_start: weekday <= 5 ? '14:00' : null,
          break_end: weekday <= 5 ? '15:00' : null,
        }))
      )
    }
    console.log(`Administrador ${email} creado. Entra en el panel y ajusta el negocio y el horario en Configuración.`)
  }
} finally {
  await closeDb(db)
}
