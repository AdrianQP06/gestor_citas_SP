import { existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import PDFDocument from 'pdfkit'
import { log } from '../../shared/logger.ts'
import { C } from '../reports/pdf/pdf.charts.ts'
import { LOGO, PAGE, registerBrandFonts } from '../reports/pdf/pdf.assets.ts'
import type { OperationEventView, OperationView } from './operations.service.ts'
import { METHOD_LABEL } from './operations.schemas.ts'

const M = { top: 84, bottom: 58, left: 40, right: 40 }
const W = PAGE.w - M.left - M.right

/** Aspecto del estado: el recibo distingue de un vistazo pendiente, confirmada y anulada. */
const STATE = {
  pending: {
    title: 'PENDIENTE DE VERIFICACIÓN',
    fill: '#fef3c7',
    border: '#f59e0b',
    ink: '#92400e',
    watermark: 'PENDIENTE',
  },
  confirmed: { title: 'CONFIRMADA', fill: '#d1fae5', border: '#059669', ink: '#065f46', watermark: null },
  voided: { title: 'ANULADA', fill: '#fee2e2', border: '#dc2626', ink: '#991b1b', watermark: 'ANULADA' },
} as const

const ACTION_LABEL = { created: 'Registrada (pendiente)', confirmed: 'Confirmada', voided: 'Anulada' } as const

export type ReceiptOptions = {
  business: string
  timezone: string
  /** Instante de generación (ISO UTC). */
  generatedAt: string
  /** Recibe cada texto dibujado (para pruebas). */
  collectText?: string[]
}

/**
 * Recibo PDF individual de una operación. Identifica la operación con su código único y muestra su
 * estado de forma inequívoca. Es un registro informativo: no acredita por sí mismo movimiento de dinero.
 */
export async function renderOperationReceipt(
  op: OperationView,
  events: OperationEventView[],
  opts: ReceiptOptions
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: M,
    bufferPages: true,
    info: {
      Title: `Recibo ${op.code} — ${opts.business}`,
      Author: 'Supernova',
      Subject: `${op.typeLabel} ${op.amountLabel} — ${op.statusLabel}`,
      Creator: 'Supernova · Gestor de citas',
    },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res, rej) => {
    doc.on('end', () => res(Buffer.concat(chunks)))
    doc.on('error', rej)
  })
  registerBrandFonts(doc)

  const text = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions = {}) => {
    opts.collectText?.push(s)
    doc.text(s, x, y, o)
  }
  const local = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(opts.timezone).setLocale('es').toFormat('dd/MM/yyyy HH:mm')
  const st = STATE[op.status]

  // Marca de agua (debajo del contenido): solo para estados que no son un registro verificado vigente.
  if (st.watermark) {
    doc.save()
    doc.rotate(-32, { origin: [PAGE.w / 2, PAGE.h / 2] })
    doc.fillColor(st.border).fillOpacity(0.1).font('MX').fontSize(92)
    text(st.watermark, 0, PAGE.h / 2 - 50, { width: PAGE.w, align: 'center', lineBreak: false })
    doc.restore()
    doc.fillOpacity(1)
  }

  // Cabecera de marca
  const hasLogo = existsSync(LOGO)
  if (!hasLogo) log.warn('receipt_logo_missing', { path: LOGO })
  if (hasLogo) doc.image(LOGO, M.left, 26, { height: 22 })
  else doc.font('MX').fontSize(15).fillColor(C.brand).text('Supernova', M.left, 28, { lineBreak: false })
  doc.font('M').fontSize(8).fillColor(C.muted)
  text(`Recibo de operación · ${opts.business}`, M.left + 200, 31, { width: W - 200, align: 'right', lineBreak: false })
  doc.lineWidth(1.6).strokeColor(C.brand).moveTo(M.left, 58).lineTo(PAGE.w - M.right, 58).stroke()
  doc.lineWidth(0.6).strokeColor(C.gold).moveTo(M.left, 61).lineTo(M.left + 46, 61).stroke()

  let y = M.top
  doc.font('MX').fontSize(22).fillColor(C.brand)
  text('Recibo de operación', M.left, y, { width: W })
  y = doc.y
  doc.font('M').fontSize(10).fillColor(C.muted)
  text(op.type === 'deposit' ? `Registro de depósito · ${op.productLabel ?? ''}` : 'Registro de reembolso al cliente', M.left, y + 1, { width: W })
  y = doc.y + 14

  // Identificador único
  doc.roundedRect(M.left, y, W, 46, 6).fillAndStroke(C.page, C.border)
  doc.font('M').fontSize(8).fillColor(C.muted)
  text('N.º de operación (identificador único)', M.left + 14, y + 9, { lineBreak: false })
  doc.font('MX').fontSize(20).fillColor(C.text)
  text(op.code, M.left + 14, y + 20, { lineBreak: false })
  y += 60

  // Estado: inequívoco
  const detail =
    op.status === 'pending'
      ? 'Registro sin verificar. Todavía no ha sido confirmado por un administrador y no acredita por sí mismo que se haya recibido ni devuelto dinero.'
      : op.status === 'confirmed'
        ? `Verificada por ${op.confirmedBy?.name ?? '—'} el ${op.confirmedAt ? local(op.confirmedAt) : '—'}. La aplicación no procesa pagos: la confirmación refleja la verificación interna de un administrador.`
        : `Anulada por ${op.voidedBy?.name ?? '—'} el ${op.voidedAt ? local(op.voidedAt) : '—'}. Motivo: ${op.voidReason ?? '—'}. Este registro no tiene validez como movimiento vigente.`
  doc.font('M').fontSize(8.5)
  const detailH = doc.heightOfString(detail, { width: W - 28 })
  const bannerH = 36 + detailH
  doc.roundedRect(M.left, y, W, bannerH, 6).fillAndStroke(st.fill, st.border)
  doc.font('MX').fontSize(15).fillColor(st.ink)
  text(st.title, M.left + 14, y + 10, { width: W - 28, lineBreak: false })
  doc.font('M').fontSize(8.5).fillColor(st.ink)
  text(detail, M.left + 14, y + 30, { width: W - 28 })
  y += bannerH + 16

  // Importe y método
  doc.font('M').fontSize(9).fillColor(C.muted)
  text(op.type === 'deposit' ? 'Importe del depósito' : 'Importe del reembolso', M.left, y, { lineBreak: false })
  doc.font('MX').fontSize(30).fillColor(op.status === 'voided' ? C.subtle : C.brand)
  text(op.amountLabel, M.left, y + 13, { lineBreak: false })
  if (op.status === 'voided') {
    const w = doc.widthOfString(op.amountLabel)
    doc.lineWidth(1.5).strokeColor('#dc2626').moveTo(M.left, y + 31).lineTo(M.left + w, y + 31).stroke()
  }
  doc.font('MB').fontSize(10).fillColor(C.text)
  text(`Método: ${METHOD_LABEL}`, M.left, y + 52, { lineBreak: false })
  y += 78

  // Detalle de la operación
  const rows: [string, string][] = [
    ['Tipo', op.typeLabel],
    ['Producto', op.productLabel ?? '—'],
    ['Referencia', op.reference ?? '—'],
    ['Fecha de registro', local(op.createdAt)],
    ['Registrada por', op.createdBy.name],
    ...(op.confirmedAt ? ([['Verificada por', `${op.confirmedBy?.name ?? '—'} · ${local(op.confirmedAt)}`]] as [string, string][]) : []),
    ...(op.voidedAt ? ([['Anulada por', `${op.voidedBy?.name ?? '—'} · ${local(op.voidedAt)}`], ['Motivo de anulación', op.voidReason ?? '—']] as [string, string][]) : []),
  ]
  const section = (title: string, list: [string, string][]) => {
    doc.font('MB').fontSize(11).fillColor(C.brand)
    text(title, M.left, y, { lineBreak: false })
    y += 17
    list.forEach(([k, v], i) => {
      doc.font('M').fontSize(9)
      const h = Math.max(16, doc.heightOfString(v, { width: W - 150 }) + 7)
      if (i % 2 === 0) doc.rect(M.left, y, W, h).fill(C.page)
      doc.font('M').fontSize(8.5).fillColor(C.muted)
      text(k, M.left + 8, y + 4, { width: 130, lineBreak: false })
      doc.font('MB').fontSize(9).fillColor(C.text)
      text(v, M.left + 142, y + 3.5, { width: W - 150 })
      y += h
    })
    y += 14
  }
  section('Detalle de la operación', rows)
  section('Cita asociada', [
    ['N.º de cita', `#${op.appointment.id}`],
    ['Cliente', op.appointment.clientName],
    ['Fecha y hora', `${op.appointment.date.slice(8)}/${op.appointment.date.slice(5, 7)}/${op.appointment.date.slice(0, 4)} · ${op.appointment.time}–${op.appointment.endTime}`],
    ['Motivo de la cita', op.appointment.reason],
  ])

  // Historial de estados
  doc.font('MB').fontSize(11).fillColor(C.brand)
  text('Historial de estados', M.left, y, { lineBreak: false })
  y += 17
  const cols = [
    { label: 'Fecha', w: 100 },
    { label: 'Acción', w: 130 },
    { label: 'Usuario', w: 130 },
    { label: 'Nota', w: W - 360 },
  ]
  doc.rect(M.left, y, W, 18).fill(C.brand)
  doc.font('MB').fontSize(7.8).fillColor('#ffffff')
  let x = M.left
  for (const c of cols) {
    text(c.label, x + 6, y + 5.5, { width: c.w - 10, lineBreak: false })
    x += c.w
  }
  y += 18
  events.forEach((e, i) => {
    const cells = [local(e.at), ACTION_LABEL[e.action], e.userName, e.note ?? '']
    doc.font('M').fontSize(8)
    const h = Math.max(...cells.map((t, k) => doc.heightOfString(t, { width: cols[k]!.w - 10 }))) + 8
    if (y + h > PAGE.h - M.bottom) {
      doc.addPage()
      y = M.top
    }
    if (i % 2) doc.rect(M.left, y, W, h).fill(C.page)
    doc.fillColor(C.text)
    let cx = M.left
    cells.forEach((t, k) => {
      text(t, cx + 6, y + 4, { width: cols[k]!.w - 10 })
      cx += cols[k]!.w
    })
    y += h
  })
  y += 16

  // Aviso
  doc.font('M').fontSize(7.6)
  const note =
    'Documento informativo generado por el Gestor de citas de Supernova. La aplicación registra operaciones pero no procesa pagos, no se integra con pasarelas y no mueve dinero: un importe registrado no significa por sí mismo que el dinero haya sido recibido o devuelto. El método de las operaciones es siempre Efectivo.'
  if (y + doc.heightOfString(note, { width: W }) > PAGE.h - M.bottom) {
    doc.addPage()
    y = M.top
  }
  doc.fillColor(C.muted)
  text(note, M.left, y, { width: W })

  // Pie con numeración
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.page.margins.bottom = 0
    doc.lineWidth(0.5).strokeColor(C.border).moveTo(M.left, PAGE.h - 40).lineTo(PAGE.w - M.right, PAGE.h - 40).stroke()
    doc.font('M').fontSize(7.5).fillColor(C.muted)
    text(`Supernova · ${op.code} · Generado el ${local(opts.generatedAt)}`, M.left, PAGE.h - 32, { width: W - 80, lineBreak: false })
    text(`Página ${i - range.start + 1} de ${range.count}`, PAGE.w - M.right - 80, PAGE.h - 32, { width: 80, align: 'right', lineBreak: false })
  }

  doc.end()
  return done
}
