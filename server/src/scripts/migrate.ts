import { dbOptions } from '../config/database.ts'
import { loadConfig } from '../config/env.ts'
import { closeDb, migrate, openDb } from '../shared/db.ts'

const db = openDb(dbOptions(loadConfig()))
try {
  const ran = await migrate(db)
  console.log(ran.length ? `Migraciones aplicadas: ${ran.join(', ')}` : 'La base de datos ya está al día.')
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await closeDb(db)
}
