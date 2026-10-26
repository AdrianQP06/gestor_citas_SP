import { existsSync } from 'node:fs'
import { DateTime } from 'luxon'
import PDFDocument from 'pdfkit'
import { log } from '../../../shared/logger.ts'
import type { Kpi, ReportData, TableSpec } from '../reports.types.ts'
import { C, drawChart, fit } from './pdf.charts.ts'
import { LOGO, PAGE, registerBrandFonts } from './pdf.assets.ts'

const M = { top: 84, bottom: 58, left: 40, right: 40 }
const CONTENT_W = PAGE.w - M.left - M.right

const TONE: Record<NonNullable<Kpi['tone']>, string> = {
  default: C.brand,
  success: '#047857',
  warning: '#b45309',
  danger: '#b91c1c',
  gold: C.gold,
}
const STATUS_TEXT: Record<string, string> = {
  Pendiente: '#b45309',
  Confirmada: C.brand,
  Completada: '#047857',
  Cancelada: '#b91c1c',
  'Pendiente de verificación': '#b45309',
  Anulada: '#b91c1c',
}

const num = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 })
const cell = (v: string | number | undefined) => (v === undefined ? '' : typeof v === 'number' ? num(v) : v)
const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

export type RenderOptions = {
  /** Si se pasa, recibe cada texto dibujado (permite comprobar en pruebas que el PDF contiene las cifras). */
  collectText?: string[]
}

const money = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatKpiValue(k: Kpi): string {
  if (k.value === null) return 'Datos insuficientes'
  if (k.format === 'money') return `${money.format(k.value)} ${k.currency ?? ''}`.trim()
  return k.format === 'percent' ? `${num(k.value)} %` : num(k.value)
}

function comparisonText(k: Kpi): { text: string; color: string } | null {
  const c = k.comparison
  if (!c) return null
  const sign = c.delta > 0 ? '+' : c.delta < 0 ? '−' : ''
  const abs = num(Math.abs(c.delta))
  const prev = k.format === 'percent' ? `${num(c.previous)} %` : num(c.previous)
  const good = k.key === 'cancelled' || k.key === 'cancellation_rate' || k.key === 'pending' ? c.delta <= 0 : c.delta >= 0
  const color = c.delta === 0 ? C.muted : good ? '#047857' : '#b91c1c'
  if (k.format === 'percent') return { text: `${sign}${abs} pp vs. anterior (${prev})`, color }
  if (c.deltaPct === null) return { text: `${sign}${abs} vs. anterior (${prev}) · sin base`, color }
  const p = `${c.deltaPct > 0 ? '+' : c.deltaPct < 0 ? '−' : ''}${num(Math.abs(c.deltaPct))} %`
  return { text: `${sign}${abs} (${p}) vs. anterior (${prev})`, color }
}

/**
 * Genera el PDF de un informe a partir de EXACTAMENTE los mismos datos que muestra la pantalla.
 * Cede el control al bucle de eventos cada ~100 filas para no retrasar reservas ni recordatorios.
 */
export async function renderReportPdf(report: ReportData, opts: RenderOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: M,
    bufferPages: true,
    info: {
      Title: `${report.title} — ${report.business}`,
      Author: 'Supernova',
      Subject: report.filterSummary[0] ?? '',
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
  const hasLogo = existsSync(LOGO)
  if (!hasLogo) log.warn('report_logo_missing', { path: LOGO })

  const tz = report.timezone
  const generated = DateTime.fromISO(report.generatedAt, { zone: 'utc' }).setZone(tz).setLocale('es')
  const generatedLabel = generated.toFormat("dd/MM/yyyy 'a las' HH:mm")

  // Cabecera de cada página: logotipo + filete de marca + título corto.
  const drawHeader = () => {
    if (hasLogo) doc.image(LOGO, M.left, 26, { height: 22 })
    else doc.font('MX').fontSize(15).fillColor(C.brand).text('Supernova', M.left, 28, { lineBreak: false })
    doc.font('M').fontSize(8).fillColor(C.muted)
    text(`${report.title} · ${report.business}`, M.left + 200, 31, { width: CONTENT_W - 200, align: 'right', lineBreak: false })
    doc.lineWidth(1.6).strokeColor(C.brand).moveTo(M.left, 58).lineTo(PAGE.w - M.right, 58).stroke()
    doc.lineWidth(0.6).strokeColor(C.gold).moveTo(M.left, 61).lineTo(M.left + 46, 61).stroke()
  }
  drawHeader()
  doc.on('pageAdded', drawHeader)

  const maxY = () => PAGE.h - M.bottom
  let y = M.top
  const ensure = (h: number) => {
    if (y + h > maxY()) {
      doc.addPage()
      y = M.top
    }
  }

  // ------------------------------------------------------------ título e información
  doc.font('MX').fontSize(21).fillColor(C.brand)
  text(report.title, M.left, y, { width: CONTENT_W })
  y = doc.y + 1
  if (report.subtitle) {
    doc.font('M').fontSize(10).fillColor(C.muted)
    text(report.subtitle, M.left, y, { width: CONTENT_W })
    y = doc.y
  }
  y += 8
  const info = [...report.filterSummary, `Generado: ${generatedLabel}`, `Negocio: ${report.business}`]
  const infoH = 14 + Math.ceil(info.length / 2) * 13
  doc.roundedRect(M.left, y, CONTENT_W, infoH, 5).fillAndStroke(C.page, C.border)
  doc.font('M').fontSize(8.5).fillColor(C.text)
  info.forEach((line, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const [k, ...rest] = line.split(': ')
    const v = rest.join(': ')
    const ix = M.left + 10 + col * (CONTENT_W / 2)
    doc.font('MB').fillColor(C.brand)
    text(`${k}: `, ix, y + 8 + row * 13, { continued: true, width: CONTENT_W / 2 - 14, lineBreak: false })
    doc.font('M').fillColor(C.text)
    text(v, ix, y + 8 + row * 13, { width: CONTENT_W / 2 - 14, lineBreak: false, ellipsis: true })
  })
  y += infoH + 14

  // ------------------------------------------------------------ vacío
  if (report.empty) {
    ensure(70)
    doc.roundedRect(M.left, y, CONTENT_W, 56, 6).fillAndStroke('#ffffff', C.border)
    doc.font('MB').fontSize(11).fillColor(C.text)
    text('Sin resultados', M.left, y + 14, { width: CONTENT_W, align: 'center' })
    doc.font('M').fontSize(9).fillColor(C.muted)
    text(report.emptyMessage, M.left + 20, y + 31, { width: CONTENT_W - 40, align: 'center' })
    y += 70
  }

  // ------------------------------------------------------------ indicadores
  if (report.kpis.length) {
    const cols = 3
    const gap = 10
    const cw = (CONTENT_W - gap * (cols - 1)) / cols
    const ch = 70
    for (let i = 0; i < report.kpis.length; i += cols) {
      ensure(ch + gap)
      report.kpis.slice(i, i + cols).forEach((k, j) => {
        const kx = M.left + j * (cw + gap)
        doc.roundedRect(kx, y, cw, ch, 5).fillAndStroke('#ffffff', C.border)
        doc.rect(kx, y + 8, 2.5, ch - 16).fill(TONE[k.tone ?? 'default'])
        doc.font('M').fontSize(8).fillColor(C.muted)
        text(fit(doc, k.label, cw - 16), kx + 11, y + 8, { lineBreak: false })
        if (k.value === null) {
          doc.font('MB').fontSize(10.5).fillColor(C.muted)
          text('Datos insuficientes', kx + 11, y + 21, { width: cw - 16, lineBreak: false })
          doc.font('M').fontSize(6.5).fillColor(C.muted)
          text(k.insufficient ?? '', kx + 11, y + 36, { width: cw - 18, height: 30, ellipsis: true })
        } else {
          doc.font('MX').fontSize(20).fillColor(TONE[k.tone ?? 'default'])
          text(formatKpiValue(k), kx + 11, y + 19, { width: cw - 16, lineBreak: false })
          const cmp = comparisonText(k)
          if (cmp) {
            doc.font('MB').fontSize(7).fillColor(cmp.color)
            text(fit(doc, cmp.text, cw - 16), kx + 11, y + 44, { lineBreak: false })
          }
          if (k.hint) {
            doc.font('M').fontSize(6.8).fillColor(C.muted)
            text(k.hint, kx + 11, y + (cmp ? 55 : 46), { width: cw - 16, height: 20, ellipsis: true })
          }
        }
      })
      y += ch + gap
    }
    y += 4
  }

  // ------------------------------------------------------------ gráficos
  if (report.charts.length) {
    ensure(40)
    doc.font('MB').fontSize(12).fillColor(C.brand)
    text('Gráficos', M.left, y, { lineBreak: false })
    y += 20
    const half = (CONTENT_W - 16) / 2
    let pending: { chart: (typeof report.charts)[number] } | null = null
    const place = (chart: (typeof report.charts)[number], x: number, w: number, h: number) => drawChart(doc, text, chart, x, y, w, h)
    const H = 158
    for (const chart of report.charts) {
      const wide = chart.kind === 'line' || chart.categories.length > 14
      if (wide) {
        if (pending) {
          ensure(H + 12)
          place(pending.chart, M.left, half, H)
          y += H + 14
          pending = null
        }
        ensure(H + 12)
        place(chart, M.left, CONTENT_W, H)
        y += H + 14
      } else if (pending) {
        ensure(H + 12)
        place(pending.chart, M.left, half, H)
        place(chart, M.left + half + 16, half, H)
        y += H + 14
        pending = null
      } else {
        pending = { chart }
      }
    }
    if (pending) {
      ensure(H + 12)
      place(pending.chart, M.left, half, H)
      y += H + 14
    }
  }

  // ------------------------------------------------------------ tablas
  for (const t of report.tables) {
    await drawTable(t)
  }

  async function drawTable(t: TableSpec) {
    const totalWeight = t.columns.reduce((s, c) => s + (c.weight ?? 1), 0)
    const widths = t.columns.map((c) => ((c.weight ?? 1) / totalWeight) * CONTENT_W)
    const PADX = 4
    const LINE = 10.5
    const headerH = 20
    const rowHeight = (row: Record<string, string | number>) => {
      doc.font('M').fontSize(8)
      let lines = 1
      t.columns.forEach((c, i) => {
        const hgt = doc.heightOfString(cell(row[c.key]), { width: widths[i]! - PADX * 2 })
        lines = Math.max(lines, Math.min(3, Math.round(hgt / LINE) || 1))
      })
      return lines * LINE + 8
    }

    const drawTitle = (continued: boolean) => {
      doc.font('MB').fontSize(12).fillColor(C.brand)
      text(continued ? `${t.title} (continuación)` : t.title, M.left, y, { lineBreak: false })
      y += 19
    }
    const drawHead = () => {
      doc.rect(M.left, y, CONTENT_W, headerH).fill(C.brand)
      doc.font('MB').fontSize(7.8).fillColor('#ffffff')
      let x = M.left
      t.columns.forEach((c, i) => {
        text(fit(doc, c.label, widths[i]! - PADX * 2), x + PADX, y + 6.5, { width: widths[i]! - PADX * 2, align: c.align ?? 'left', lineBreak: false })
        x += widths[i]!
      })
      y += headerH
    }

    const first = t.rows[0]
    ensure(19 + headerH + (first ? rowHeight(first) * 2 : 40))
    drawTitle(false)
    if (!t.rows.length) {
      doc.roundedRect(M.left, y, CONTENT_W, 34, 5).fillAndStroke(C.page, C.border)
      doc.font('M').fontSize(9).fillColor(C.muted)
      text(t.emptyMessage, M.left, y + 12, { width: CONTENT_W, align: 'center' })
      y += 48
      return
    }
    drawHead()

    const drawRow = (row: Record<string, string | number>, fill: string | null, bold: boolean) => {
      const h = rowHeight(row)
      if (fill) doc.rect(M.left, y, CONTENT_W, h).fill(fill)
      doc.lineWidth(0.3).strokeColor(C.border).moveTo(M.left, y + h).lineTo(M.left + CONTENT_W, y + h).stroke()
      let x = M.left
      t.columns.forEach((c, i) => {
        const value = cell(row[c.key])
        const color = !bold && c.key === 'status' && STATUS_TEXT[value] ? STATUS_TEXT[value]! : C.text
        doc.font(bold || (c.key === 'status' && !!STATUS_TEXT[value]) ? 'MB' : 'M').fontSize(8).fillColor(color)
        text(value, x + PADX, y + 4, { width: widths[i]! - PADX * 2, height: LINE * 3, align: c.align ?? 'left', ellipsis: true })
        x += widths[i]!
      })
      y += h
    }

    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i]!
      if (y + rowHeight(row) > maxY()) {
        doc.addPage()
        y = M.top
        drawTitle(true)
        drawHead() // la cabecera de la tabla se repite en cada página
      }
      drawRow(row, i % 2 ? C.page : null, false)
      if (i % 100 === 99) await yieldLoop()
    }
    if (t.totals) {
      if (y + 22 > maxY()) {
        doc.addPage()
        y = M.top
        drawTitle(true)
        drawHead()
      }
      drawRow(t.totals, C.brandTint, true)
    }
    if (t.omittedRows) {
      doc.font('M').fontSize(7.5).fillColor(C.muted)
      y += 4
      text(`Se muestran ${t.rows.length.toLocaleString('es-ES')} de ${t.totalRows.toLocaleString('es-ES')} filas (tope de seguridad). Acota el período o los filtros para ver el resto.`, M.left, y, { width: CONTENT_W })
      y = doc.y
    }
    y += 16
  }

  // ------------------------------------------------------------ definiciones
  if (report.notes.length) {
    ensure(60)
    doc.font('MB').fontSize(12).fillColor(C.brand)
    text('Definiciones y notas', M.left, y, { lineBreak: false })
    y += 18
    for (const n of report.notes) {
      doc.font('M').fontSize(7.8)
      const h = doc.heightOfString(n, { width: CONTENT_W - 10 }) + 5
      ensure(h)
      doc.circle(M.left + 2, y + 4, 1.4).fill(C.gold)
      doc.fillColor(C.muted)
      text(n, M.left + 10, y, { width: CONTENT_W - 10 })
      y += h
    }
  }

  // ------------------------------------------------------------ pie con numeración
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.page.margins.bottom = 0 // permite escribir en la zona del pie sin provocar un salto de página
    doc.lineWidth(0.5).strokeColor(C.border).moveTo(M.left, PAGE.h - 40).lineTo(PAGE.w - M.right, PAGE.h - 40).stroke()
    doc.font('M').fontSize(7.5).fillColor(C.muted)
    text(`Supernova · Gestor de citas · Generado el ${generatedLabel}`, M.left, PAGE.h - 32, { width: CONTENT_W - 80, lineBreak: false })
    text(`Página ${i - range.start + 1} de ${range.count}`, PAGE.w - M.right - 80, PAGE.h - 32, { width: 80, align: 'right', lineBreak: false })
  }

  doc.end()
  return done
}
