import { randomUUID } from 'node:crypto'
import type { Config } from '../../config/env.ts'
import { log } from '../../shared/logger.ts'

export type ReminderMessage = {
  /** Teléfono del destinatario en formato E.164 (+34600111222). */
  to: string
  clientName: string
  /** Hora local de la cita (HH:mm). */
  time: string
  reason: string
}

export type SendResult = { provider: 'test' | 'meta'; messageId: string }

export class WhatsAppError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

export interface WhatsAppProvider {
  readonly name: 'test' | 'meta'
  /** false si faltan credenciales: el worker no intenta enviar y deja los recordatorios en cola. */
  readonly configured: boolean
  send(msg: ReminderMessage): Promise<SendResult>
}

/** Los parámetros de plantilla de Meta no admiten saltos de línea, tabuladores ni muchos espacios seguidos. */
function sanitizeParam(value: string): string {
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return (clean || '-').slice(0, 200)
}

/** Códigos de error de la Cloud API que merece la pena reintentar (límites de tasa, fallos temporales). */
const RETRYABLE_META_CODES = new Set([4, 17, 80007, 130429, 131016, 131048, 131056, 133004, 133016])

/**
 * Proveedor oficial: WhatsApp Business Cloud API (Meta).
 * Los mensajes iniciados por la empresa deben usar una plantilla aprobada (ver README).
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta' as const
  private cfg: Config
  private fetchImpl: typeof fetch
  constructor(cfg: Config, fetchImpl: typeof fetch = fetch) {
    this.cfg = cfg
    this.fetchImpl = fetchImpl
  }

  get configured() {
    return !!this.cfg.WHATSAPP_TOKEN && !!this.cfg.WHATSAPP_PHONE_NUMBER_ID
  }

  async send(msg: ReminderMessage): Promise<SendResult> {
    if (!this.configured) throw new WhatsAppError('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID.', false)
    const url = `${this.cfg.WHATSAPP_API_BASE}/${this.cfg.WHATSAPP_API_VERSION}/${this.cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`
    const body = {
      messaging_product: 'whatsapp',
      to: msg.to.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: this.cfg.WHATSAPP_TEMPLATE_NAME,
        language: { code: this.cfg.WHATSAPP_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [msg.clientName, msg.time, msg.reason].map((text) => ({
              type: 'text',
              text: sanitizeParam(text),
            })),
          },
        ],
      },
    }

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new WhatsAppError(`Error de red al contactar con WhatsApp: ${(err as Error).message}`, true)
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: { message?: string; code?: number; error_data?: { details?: string } }
    }
    if (!res.ok || json.error) {
      const e = json.error
      const detail = e?.error_data?.details ?? e?.message ?? `HTTP ${res.status}`
      const retryable = res.status >= 500 || res.status === 429 || (e?.code !== undefined && RETRYABLE_META_CODES.has(e.code))
      throw new WhatsAppError(`WhatsApp rechazó el mensaje (${e?.code ?? res.status}): ${detail}`, retryable)
    }
    const messageId = json.messages?.[0]?.id
    if (!messageId) throw new WhatsAppError('Respuesta de WhatsApp sin identificador de mensaje.', true)
    return { provider: 'meta', messageId }
  }
}

/**
 * Modo de prueba: NO envía ningún mensaje real. Solo deja constancia en el log.
 * La interfaz lo señala de forma visible y los recordatorios quedan marcados con proveedor "test".
 */
export class TestWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'test' as const
  readonly configured = true
  async send(msg: ReminderMessage): Promise<SendResult> {
    log.info('whatsapp_test_mode_message', { to: msg.to, client: msg.clientName, time: msg.time, reason: msg.reason })
    return { provider: 'test', messageId: `test-${randomUUID()}` }
  }
}

export function createProvider(cfg: Config, fetchImpl?: typeof fetch): WhatsAppProvider {
  return cfg.WHATSAPP_PROVIDER === 'meta' ? new MetaWhatsAppProvider(cfg, fetchImpl) : new TestWhatsAppProvider()
}

/** Estado del proveedor para mostrarlo en la interfaz (nunca incluye secretos). */
export function describeProvider(provider: WhatsAppProvider, cfg: Config) {
  return {
    provider: provider.name,
    configured: provider.configured,
    testMode: provider.name === 'test',
    templateName: provider.name === 'meta' ? cfg.WHATSAPP_TEMPLATE_NAME : null,
  }
}
