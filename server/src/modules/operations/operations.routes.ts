import { Hono } from 'hono'
import { staffActor, body, intParam } from '../../http/helpers.ts'
import { clientIp, RateLimiter } from '../../http/request.ts'
import { audit } from '../../shared/audit.ts'
import type { DB } from '../../shared/db.ts'
import { AppError, notFound } from '../../shared/errors.ts'
import { nowUtc } from '../../shared/time.ts'
import { requireAuth, type AuthVars } from '../auth/auth.policy.ts'
import { getSettings } from '../settings/settings.service.ts'
import { renderOperationReceipt } from './operations.receipt.ts'
import { createOperationSchema, listQuerySchema, voidOperationSchema } from './operations.schemas.ts'
import { confirmOperation, createOperation, getOperation, listOperations, voidOperation } from './operations.service.ts'

/**
 * Registro de operaciones (depósitos y reembolsos) de las citas. Montado en /api/v1/operations.
 *  - Ver, registrar y descargar recibos: personal y administradores.
 *  - Confirmar: SOLO administradores (también se comprueba en el servicio).
 *  - Anular: quien la registró (si está pendiente) o un administrador; las confirmadas, solo administradores.
 * Solo registra: no mueve dinero ni se integra con pasarelas de pago.
 */
export function operationRoutes(db: DB) {
  const app = new Hono<AuthVars>()
  app.use('*', requireAuth(db))
  const writes = new RateLimiter(60, 10 * 60_000)
  const receipts = new RateLimiter(60, 10 * 60_000)
  const limit = (l: RateLimiter, userId: number) => {
    if (!l.hit(String(userId))) throw new AppError(429, 'rate_limited', 'Demasiadas peticiones. Espera unos minutos.')
  }

  app.get('/', async (c) => {
    const { appointmentId } = listQuerySchema.parse(c.req.query())
    return c.json({ operations: await listOperations(db, appointmentId) })
  })

  app.post('/', async (c) => {
    limit(writes, c.get('user').id)
    const input = await body(c, createOperationSchema)
    const result = await createOperation(db, input, c.get('user'), staffActor(c))
    return c.json(result, 201)
  })

  app.get('/:id', async (c) => c.json(await getOperation(db, intParam(c, 'id'))))

  app.post('/:id/confirm', async (c) => {
    limit(writes, c.get('user').id)
    return c.json(await confirmOperation(db, intParam(c, 'id'), c.get('user'), staffActor(c)))
  })

  app.post('/:id/void', async (c) => {
    limit(writes, c.get('user').id)
    const { reason } = await body(c, voidOperationSchema)
    return c.json(await voidOperation(db, intParam(c, 'id'), reason, c.get('user'), staffActor(c)))
  })

  // Recibo PDF individual (vista previa en línea o descarga con ?download=1).
  app.get('/:id/receipt', async (c) => {
    limit(receipts, c.get('user').id)
    const { operation, events } = await getOperation(db, intParam(c, 'id'))
    // Acceso rápido desde una cita: si se indica la cita, la operación DEBE pertenecerle (404 si no, sin revelar nada).
    const fromAppointment = c.req.query('appointmentId')
    if (fromAppointment !== undefined && String(operation.appointmentId) !== fromAppointment)
      throw notFound('La operación no existe en esta cita.')
    const settings = await getSettings(db)
    const pdf = await renderOperationReceipt(operation, events, {
      business: settings.business_name,
      timezone: settings.timezone,
      generatedAt: nowUtc().toISO()!,
    })
    const download = c.req.query('download') === '1'
    await audit(db, { ...staffActor(c), ip: clientIp(c) }, 'operation.receipt', 'operation', operation.id, {
      code: operation.code,
      status: operation.status,
      mode: download ? 'download' : 'preview',
    })
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="recibo-${operation.code}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  return app
}
