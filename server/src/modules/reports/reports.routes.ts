import { Hono } from 'hono'
import { clientIp, RateLimiter } from '../../http/request.ts'
import { staffActor } from '../../http/helpers.ts'
import { audit } from '../../shared/audit.ts'
import type { DB } from '../../shared/db.ts'
import { AppError, forbidden } from '../../shared/errors.ts'
import { log } from '../../shared/logger.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { renderReportPdf } from './pdf/pdf.renderer.ts'
import { topReasonOptions } from './reports.queries.ts'
import { ReportInputError, reportQuerySchema, reportTypeSchema } from './reports.schemas.ts'
import { buildReport } from './reports.service.ts'
import { REPORT_TITLES, REPORT_TYPES, type ReportType } from './reports.types.ts'

/**
 * Autorización por informe. El informe de clientes contiene datos personales (nombre, teléfono, correo)
 * y solo lo ve un administrador; el resto muestra, como mucho, nombre y teléfono, igual que la agenda.
 */
export const ADMIN_ONLY: ReportType[] = ['clients', 'operations']

/** Máximo de PDF generándose a la vez: acota CPU/memoria para no afectar a reservas ni recordatorios. */
const MAX_CONCURRENT_PDFS = 2

function inputError(err: unknown): never {
  if (err instanceof ReportInputError) throw new AppError(400, 'validation', err.message, err.fields)
  throw err
}

export function reportRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))
  const views = new RateLimiter(120, 5 * 60_000)
  const pdfs = new RateLimiter(30, 10 * 60_000)
  let activePdfs = 0

  const limit = (limiter: RateLimiter, userId: number) => {
    if (!limiter.hit(String(userId)))
      throw new AppError(429, 'rate_limited', 'Demasiadas peticiones de informes. Espera unos minutos.')
  }

  function parse(c: import('hono').Context<AuthVars>) {
    const type = reportTypeSchema.safeParse(c.req.param('type'))
    if (!type.success) throw new AppError(404, 'not_found', 'Informe no encontrado.')
    if (ADMIN_ONLY.includes(type.data) && c.get('user').role !== 'admin')
      throw forbidden('Este informe contiene datos personales y solo está disponible para administradores.')
    const query = reportQuerySchema.parse(c.req.query())
    return { type: type.data, query }
  }

  // Tipos disponibles según el rol + motivos habituales para el filtro.
  app.get('/options', async (c) => {
    const role = c.get('user').role
    return c.json({
      types: REPORT_TYPES.filter((t) => role === 'admin' || !ADMIN_ONLY.includes(t)).map((t) => ({ type: t, title: REPORT_TITLES[t] })),
      reasons: await topReasonOptions(db),
    })
  })

  app.get('/:type', async (c) => {
    limit(views, c.get('user').id)
    const { type, query } = parse(c)
    const report = await buildReport(db, type, query).catch(inputError)
    if (ADMIN_ONLY.includes(type)) {
      await audit(db, staffActor(c), 'report.view', 'report', type, { from: report.filters.from, to: report.filters.to })
    }
    return c.json({ report })
  })

  app.get('/:type/pdf', async (c) => {
    const user = c.get('user')
    limit(pdfs, user.id)
    const { type, query } = parse(c)
    if (activePdfs >= MAX_CONCURRENT_PDFS)
      throw new AppError(429, 'busy', 'Se están generando otros informes. Inténtalo de nuevo en unos segundos.')
    activePdfs++
    try {
      const report = await buildReport(db, type, query).catch(inputError)
      const started = Date.now()
      const pdf = await renderReportPdf(report)
      const download = query.download === '1'
      await audit(db, { ...staffActor(c), ip: clientIp(c) }, 'report.pdf', 'report', type, {
        from: report.filters.from,
        to: report.filters.to,
        statuses: report.filters.statuses,
        reason: report.filters.reason || undefined,
        mode: download ? 'download' : 'preview',
        kb: Math.round(pdf.length / 1024),
        ms: Date.now() - started,
      })
      const filename = `supernova-${type}-${report.filters.from}_${report.filters.to}.pdf`
      return new Response(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      if (!(err instanceof AppError)) log.error('report_pdf_failed', { type, error: (err as Error).message })
      throw err
    } finally {
      activePdfs--
    }
  })

  return app
}
