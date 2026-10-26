import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  /** Interfaz de escucha. En producción detrás de Caddy/Nginx: 127.0.0.1. */
  HOST: z.string().default('127.0.0.1'),
  /** Aplica las migraciones al arrancar. Por defecto solo en desarrollo; en producción usa `npm run migrate`. */
  AUTO_MIGRATE: bool.optional(),
  /** URL pública de la aplicación (se usa para construir los enlaces del portal). */
  APP_URL: z.string().default('http://localhost:5173'),
  /** mysql://usuario:contraseña@host:3306/base (MySQL 8 / MariaDB 10.4+). */
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL debe tener la forma mysql://usuario:clave@host:3306/base'),
  /** TLS con verificación del certificado (obligatorio con MySQL gestionado de DigitalOcean). */
  DATABASE_SSL: bool.default(false),
  /** Ruta al certificado CA del servidor (opcional con DATABASE_SSL). */
  DATABASE_SSL_CA: z.string().default(''),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  LOG_FILE: z.string().default('./data/app.log'),
  /** true si la app está detrás de un proxy inverso propio (usa X-Forwarded-For). */
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Cookie Secure; por defecto activa en producción. */
  COOKIE_SECURE: bool.optional(),
  /** Si es true se arranca el worker de recordatorios en este proceso. */
  REMINDER_WORKER: bool.default(true),
  REMINDER_POLL_SECONDS: z.coerce.number().int().positive().default(20),

  // --- WhatsApp ---
  /** 'test' (no envía nada real) o 'meta' (WhatsApp Business Cloud API oficial). */
  WHATSAPP_PROVIDER: z.enum(['test', 'meta']).default('test'),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_TEMPLATE_NAME: z.string().default('recordatorio_cita'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('es'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_API_BASE: z.string().default('https://graph.facebook.com'),

  // --- Usuario administrador de demostración (solo `npm run seed`). Sin contraseña por defecto en el código:
  //     si no se define SEED_ADMIN_PASSWORD, el seed genera una aleatoria y la muestra una sola vez.
  SEED_ADMIN_EMAIL: z.string().default('admin@demo.local'),
  SEED_ADMIN_PASSWORD: z.string().min(10, 'SEED_ADMIN_PASSWORD debe tener al menos 10 caracteres.').optional(),
})

export type Config = Omit<z.infer<typeof schema>, 'AUTO_MIGRATE'> & { cookieSecure: boolean; AUTO_MIGRATE: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env)
  if (parsed.NODE_ENV === 'production') {
    // Salvaguardas de producción: HTTPS obligatorio y cookie de sesión segura.
    if (!parsed.APP_URL.startsWith('https://')) throw new Error('En producción APP_URL debe empezar por https://')
    if (parsed.COOKIE_SECURE === false) throw new Error('En producción COOKIE_SECURE no puede ser false')
  }
  return {
    ...parsed,
    cookieSecure: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
    AUTO_MIGRATE: parsed.AUTO_MIGRATE ?? parsed.NODE_ENV !== 'production',
  }
}
