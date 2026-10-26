import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { ZodError } from 'zod'
import { setTrustProxy } from './http/request.ts'
import type { Config } from './config/env.ts'
import type { DB } from './shared/db.ts'
import { AppError } from './shared/errors.ts'
import { log } from './shared/logger.ts'
import { auditRoutes } from './modules/audit/audit.routes.ts'
import { authRoutes } from './modules/auth/auth.routes.ts'
import { appointmentRoutes } from './modules/appointments/appointments.routes.ts'
import { calendarRoutes } from './modules/appointments/calendar.routes.ts'
import { availabilityRoutes } from './modules/availability/availability.routes.ts'
import { customerRoutes } from './modules/customers/customers.routes.ts'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.ts'
import { notificationRoutes } from './modules/notifications/notifications.routes.ts'
import { operationRoutes } from './modules/operations/operations.routes.ts'
import { portalRoutes } from './modules/portal/portal.routes.ts'
import { supportRoutes } from './modules/support/support.routes.ts'
import { reportRoutes } from './modules/reports/reports.routes.ts'
import { settingsRoutes } from './modules/settings/settings.routes.ts'
import { userRoutes } from './modules/users/users.routes.ts'
import type { WhatsAppProvider } from './integrations/whatsapp/whatsapp.provider.ts'

export type AppDeps = {
  db: DB
  config: Config
  provider: WhatsAppProvider
  /** Carpeta con el build del frontend (opcional; en desarrollo lo sirve Vite). */
  webDist?: string
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function createApp({ db, config, provider, webDist }: AppDeps) {
  setTrustProxy(config.TRUST_PROXY)
  const app = new Hono()

  // Los PDF (informes y recibos) se muestran en un iframe de la propia app: SOLO sus respuestas relajan
  // frame-ancestors y object-src (el visor de PDF del navegador los necesita). El resto de la aplicación
  // mantiene la política estricta de abajo. Este middleware va ANTES de secureHeaders, que escribe sus
  // cabeceras al volver de la cadena, así que sobrescribe lo que haya puesto por defecto.
  const PDF_PATH = /^\/api\/v1\/(reports\/[^/]+\/pdf|operations\/\d+\/receipt)$/
  app.use('/api/v1/*', async (c, next) => {
    await next()
    if (c.req.method === 'GET' && PDF_PATH.test(c.req.path) && c.res.headers.get('content-type') === 'application/pdf') {
      c.res.headers.set('Content-Security-Policy', "default-src 'none'; object-src 'self'; frame-ancestors 'self'")
      c.res.headers.set('X-Frame-Options', 'SAMEORIGIN')
    }
  })

  // Cabeceras de seguridad. CSP estricta: la app no carga recursos de terceros (la tipografía va autoalojada).
  app.use(
    '*',
    secureHeaders({
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: config.cookieSecure ? 'max-age=31536000; includeSubDomains' : false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Radix/Recharts aplican estilos en línea
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
      xFrameOptions: 'DENY',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    })
  )

  // Defensa CSRF adicional a SameSite=Lax: las peticiones que modifican datos deben venir
  // del mismo origen (o del configurado en APP_URL) y ser JSON.
  const allowedOrigins = new Set([new URL(config.APP_URL).origin])
  app.use('/api/*', async (c, next) => {
    if (UNSAFE.has(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin) {
        const host = c.req.header('host')
        const sameHost = host ? new URL(origin).host === host : false
        if (!sameHost && !allowedOrigins.has(origin)) {
          throw new AppError(403, 'bad_origin', 'Origen de la petición no permitido.')
        }
      }
    }
    c.header('Cache-Control', 'no-store')
    await next()
  })

  // API versionada: todo cuelga de /api/v1. Un cambio incompatible crearía /api/v2 conservando v1.
  const v1 = new Hono()
  v1.get('/health', (c) => c.json({ ok: true, whatsapp: provider.name }))
  v1.route('/auth', authRoutes(db, config))
  v1.route('/public', portalRoutes(db)) // portal de reservas (sin sesión)
  v1.route('/dashboard', dashboardRoutes(db))
  v1.route('/calendar', calendarRoutes(db))
  v1.route('/appointments', appointmentRoutes(db))
  v1.route('/availability', availabilityRoutes(db))
  v1.route('/customers', customerRoutes(db))
  v1.route('/settings', settingsRoutes(db, config, provider))
  v1.route('/', notificationRoutes(db, config, provider)) // /whatsapp/* y /notifications/*
  v1.route('/users', userRoutes(db))
  v1.route('/audit', auditRoutes(db))
  v1.route('/reports', reportRoutes(db)) // informes y PDF (solo lectura)
  v1.route('/support-requests', supportRoutes(db)) // bandeja interna de solicitudes de atención
  v1.route('/operations', operationRoutes(db)) // registro de depósitos y reembolsos (no mueve dinero)
  app.route('/api/v1', v1)

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'not_found', message: 'Ruta no encontrada.' } }, 404)
    return c.text('Not found', 404)
  })

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
        err.status as 400
      )
    }
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {}
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_'
        fields[key] ??= issue.message
      }
      const first = Object.values(fields)[0] ?? 'Datos no válidos.'
      return c.json({ error: { code: 'validation', message: first, fields } }, 400)
    }
    log.error('unhandled_error', { path: c.req.path, method: c.req.method, error: err.message, stack: err.stack })
    return c.json({ error: { code: 'internal', message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo.' } }, 500)
  })

  if (webDist && existsSync(join(webDist, 'index.html'))) {
    const indexHtml = readFileSync(join(webDist, 'index.html'), 'utf8')
    app.use('/*', serveStatic({ root: webDist }))
    app.get('*', (c) => c.html(indexHtml))
  }

  return app
}
