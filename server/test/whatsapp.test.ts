import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MetaWhatsAppProvider,
  TestWhatsAppProvider,
  WhatsAppError,
  createProvider,
  describeProvider,
} from '../src/integrations/whatsapp/whatsapp.provider.ts'
import { makeConfig } from './helpers.ts'

const msg = { to: '+34 600 111 222', clientName: 'Ana\nPérez', time: '10:30', reason: 'Revisión   general' }

const metaConfig = () =>
  makeConfig({
    WHATSAPP_PROVIDER: 'meta',
    WHATSAPP_TOKEN: 'token-secreto',
    WHATSAPP_PHONE_NUMBER_ID: '12345',
    WHATSAPP_TEMPLATE_NAME: 'recordatorio_cita',
    WHATSAPP_TEMPLATE_LANG: 'es',
  })

function fakeFetch(status: number, json: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { impl, calls }
}

test('Cloud API: petición de plantilla con token, destinatario sin "+" y parámetros saneados', async () => {
  const { impl, calls } = fakeFetch(200, { messages: [{ id: 'wamid.ABC' }] })
  const provider = new MetaWhatsAppProvider(metaConfig(), impl)
  const result = await provider.send(msg)
  assert.deepEqual(result, { provider: 'meta', messageId: 'wamid.ABC' })

  const call = calls[0]!
  assert.equal(call.url, 'https://graph.facebook.com/v21.0/12345/messages')
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer token-secreto')
  const body = JSON.parse(call.init.body as string)
  assert.equal(body.messaging_product, 'whatsapp')
  assert.equal(body.to, '34600111222')
  assert.equal(body.type, 'template')
  assert.equal(body.template.name, 'recordatorio_cita')
  assert.equal(body.template.language.code, 'es')
  assert.deepEqual(
    body.template.components[0].parameters.map((p: { text: string }) => p.text),
    ['Ana Pérez', '10:30', 'Revisión general'],
    'sin saltos de línea ni espacios repetidos (los rechaza la API)'
  )
})

test('Cloud API: errores permanentes no se reintentan; los temporales sí', async () => {
  const permanent = fakeFetch(400, { error: { code: 132001, message: 'Template does not exist', error_data: { details: 'plantilla inexistente' } } })
  await assert.rejects(
    new MetaWhatsAppProvider(metaConfig(), permanent.impl).send(msg),
    (e: WhatsAppError) => e instanceof WhatsAppError && e.retryable === false && /plantilla inexistente/.test(e.message)
  )
  const rate = fakeFetch(429, { error: { code: 130429, message: 'Rate limit hit' } })
  await assert.rejects(new MetaWhatsAppProvider(metaConfig(), rate.impl).send(msg), (e: WhatsAppError) => e.retryable === true)
  const server = fakeFetch(503, {})
  await assert.rejects(new MetaWhatsAppProvider(metaConfig(), server.impl).send(msg), (e: WhatsAppError) => e.retryable === true)
  const network = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  await assert.rejects(new MetaWhatsAppProvider(metaConfig(), network).send(msg), (e: WhatsAppError) => e.retryable === true)
  const noId = fakeFetch(200, { messages: [] })
  await assert.rejects(new MetaWhatsAppProvider(metaConfig(), noId.impl).send(msg), WhatsAppError)
})

test('sin credenciales el proveedor Meta se declara no configurado y no llama a la red', async () => {
  const { impl, calls } = fakeFetch(200, {})
  const provider = new MetaWhatsAppProvider(makeConfig({ WHATSAPP_PROVIDER: 'meta' }), impl)
  assert.equal(provider.configured, false)
  await assert.rejects(provider.send(msg), (e: WhatsAppError) => e.retryable === false)
  assert.equal(calls.length, 0)
})

test('el modo de prueba se identifica claramente y no sale a la red', async () => {
  const cfg = makeConfig()
  const provider = createProvider(cfg)
  assert.ok(provider instanceof TestWhatsAppProvider)
  const result = await provider.send(msg)
  assert.equal(result.provider, 'test')
  assert.match(result.messageId, /^test-/)
  assert.deepEqual(describeProvider(provider, cfg), { provider: 'test', configured: true, testMode: true, templateName: null })
  const meta = describeProvider(createProvider(metaConfig()), metaConfig())
  assert.equal(meta.testMode, false)
  assert.equal(meta.templateName, 'recordatorio_cita')
  assert.ok(!JSON.stringify(meta).includes('token-secreto'), 'nunca se expone el token')
})
