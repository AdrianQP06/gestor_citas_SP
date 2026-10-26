import type PDFDocument from 'pdfkit'
import type { ChartSpec } from '../reports.types.ts'

export const C = {
  brand: '#040167',
  brandSoft: '#5a5acb',
  brandTint: '#e8e8f7',
  gold: '#96731a',
  text: '#1e293b',
  muted: '#64748b',
  subtle: '#94a3b8',
  border: '#e2e8f0',
  page: '#f8fafc',
}
const PALETTE = [C.brand, C.brandSoft, C.gold, C.subtle, '#059669', '#dc2626']

type Doc = InstanceType<typeof PDFDocument>
export type TextFn = (text: string, x: number, y: number, opts?: PDFKit.Mixins.TextOptions) => void

/** Recorta `s` con «…» para que quepa en `width` con la fuente y tamaño actuales (sin saltos de línea). */
export function fit(doc: Doc, s: string, width: number): string {
  if (doc.widthOfString(s) <= width) return s
  let out = s
  while (out.length > 1 && doc.widthOfString(`${out}…`) > width) out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

const fmt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 })

/** Máximo «redondo» del eje Y (1, 2, 5 × 10ⁿ) y número de divisiones. */
function niceMax(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 1 }
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  const f = max / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  const top = nice * exp
  return { top, step: top / (nice === 5 || nice === 10 ? 5 : nice === 2 ? 4 : 5) }
}

function legend(doc: Doc, text: TextFn, items: { name: string; color: string }[], x: number, y: number) {
  let cx = x
  doc.font('M').fontSize(7)
  for (const it of items) {
    doc.rect(cx, y + 1.5, 6, 6).fill(it.color)
    text(it.name, cx + 9, y, { lineBreak: false })
    cx += 9 + doc.widthOfString(it.name) + 12
  }
}

/** Todos los gráficos se dibujan en vectores dentro de (x, y, w, h); `h` incluye el título. */
export function drawChart(doc: Doc, text: TextFn, chart: ChartSpec, x: number, y: number, w: number, h: number) {
  doc.font('MB').fontSize(9.5).fillColor(C.text)
  text(fit(doc, chart.title, w), x, y, { lineBreak: false })
  const top = y + 20
  const height = h - 20
  switch (chart.kind) {
    case 'bar':
    case 'groupedBar':
    case 'line':
      return drawAxisChart(doc, text, chart, x, top, w, height)
    case 'donut':
      return drawDonut(doc, text, chart, x, top, w, height)
    case 'hbar':
      return drawHBar(doc, text, chart, x, top, w, height)
  }
}

function drawAxisChart(doc: Doc, text: TextFn, chart: ChartSpec, x: number, y: number, w: number, h: number) {
  const multi = chart.series.length > 1
  if (multi) legend(doc, text, chart.series.map((s, i) => ({ name: s.name, color: s.color ?? PALETTE[i % PALETTE.length]! })), x, y)
  const plotTop = y + (multi ? 14 : 4)
  const left = x + 26
  const right = x + w - 4
  const bottom = y + h - 16
  const max = Math.max(0, ...chart.series.flatMap((s) => s.values))
  const { top: axisMax, step } = niceMax(max)
  const plotH = bottom - plotTop

  doc.lineWidth(0.4).strokeColor(C.border).font('M').fontSize(7).fillColor(C.muted)
  for (let v = 0; v <= axisMax + 1e-9; v += step) {
    const gy = bottom - (v / axisMax) * plotH
    doc.moveTo(left, gy).lineTo(right, gy).stroke()
    text(fmt(v), x, gy - 3, { width: 22, align: 'right', lineBreak: false })
  }

  const n = chart.categories.length
  const slot = (right - left) / Math.max(1, n)
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((right - left) / 30))))
  doc.font('M').fontSize(7).fillColor(C.muted)
  chart.categories.forEach((cat, i) => {
    if (i % labelEvery === 0) text(cat, left + i * slot - 4, bottom + 4, { width: slot * labelEvery + 8, align: 'center', lineBreak: false })
  })

  if (chart.kind === 'line') {
    chart.series.forEach((s, si) => {
      const color = s.color ?? PALETTE[si % PALETTE.length]!
      const pts = s.values.map((v, i) => [left + slot * (i + 0.5), bottom - (v / axisMax) * plotH] as const)
      doc.lineWidth(1.4).strokeColor(color)
      pts.forEach(([px, py], i) => (i === 0 ? doc.moveTo(px, py) : doc.lineTo(px, py)))
      doc.stroke()
      if (n <= 31) pts.forEach(([px, py]) => doc.circle(px, py, 1.6).fill(color))
    })
    return
  }

  const k = chart.series.length
  const groupW = slot * 0.72
  const barW = groupW / k
  chart.series.forEach((s, si) => {
    const color = s.color ?? PALETTE[si % PALETTE.length]!
    s.values.forEach((v, i) => {
      const bh = (v / axisMax) * plotH
      const bx = left + slot * i + (slot - groupW) / 2 + si * barW
      if (bh > 0) doc.rect(bx, bottom - bh, Math.max(1, barW - 1), bh).fill(color)
      if (n <= 12 && v > 0) {
        doc.font('M').fontSize(6.5).fillColor(C.text)
        text(fmt(v), bx - 4, bottom - bh - 8, { width: barW + 6, align: 'center', lineBreak: false })
      }
    })
  })
}

function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
}

function drawDonut(doc: Doc, text: TextFn, chart: ChartSpec, x: number, y: number, w: number, h: number) {
  const values = chart.series[0]?.values ?? []
  const total = values.reduce((s, v) => s + v, 0)
  const r1 = Math.min(h - 8, w * 0.46) / 2
  const r0 = r1 * 0.58
  const cx = x + r1 + 2
  const cy = y + h / 2
  const colors = chart.colors ?? PALETTE
  if (total > 0) {
    let a = -Math.PI / 2
    const nonZero = values.filter((v) => v > 0).length
    values.forEach((v, i) => {
      if (v <= 0) return
      if (nonZero === 1) {
        doc.circle(cx, cy, r1).fill(colors[i % colors.length]!)
        doc.circle(cx, cy, r0).fill('#ffffff')
      } else {
        const next = a + (v / total) * Math.PI * 2
        doc.path(sector(cx, cy, r0, r1, a, next)).fill(colors[i % colors.length]!)
        a = next
      }
    })
    doc.font('MB').fontSize(14).fillColor(C.text)
    text(fmt(total), cx - r0, cy - 9, { width: r0 * 2, align: 'center', lineBreak: false })
    doc.font('M').fontSize(6.5).fillColor(C.muted)
    text('citas', cx - r0, cy + 6, { width: r0 * 2, align: 'center', lineBreak: false })
  }
  const lx = cx + r1 + 16
  let ly = y + Math.max(0, (h - chart.categories.length * 14) / 2)
  chart.categories.forEach((cat, i) => {
    doc.rect(lx, ly + 1.5, 7, 7).fill(colors[i % colors.length]!)
    doc.font('M').fontSize(7.5).fillColor(C.text)
    const share = total ? ` (${fmt(Math.round(((values[i] ?? 0) / total) * 1000) / 10)} %)` : ''
    text(fit(doc, `${cat}: ${fmt(values[i] ?? 0)}${share}`, x + w - lx - 11), lx + 11, ly, { lineBreak: false })
    ly += 14
  })
}

function drawHBar(doc: Doc, text: TextFn, chart: ChartSpec, x: number, y: number, w: number, h: number) {
  const values = chart.series[0]?.values ?? []
  const color = chart.series[0]?.color ?? C.brand
  const n = Math.max(1, values.length)
  const rowH = Math.min(18, (h - 2) / n)
  const labelW = w * 0.42
  const max = Math.max(1, ...values)
  const barMax = w - labelW - 34
  values.forEach((v, i) => {
    const ry = y + i * rowH
    doc.font('M').fontSize(7.5).fillColor(C.text)
    text(fit(doc, chart.categories[i] ?? '', labelW - 6), x, ry + (rowH - 8) / 2 - 1, { lineBreak: false })
    const bw = (v / max) * barMax
    doc.rect(x + labelW, ry + 2, Math.max(1, bw), rowH - 5).fill(color)
    doc.font('MB').fontSize(7.5).fillColor(C.text)
    text(fmt(v), x + labelW + bw + 4, ry + (rowH - 8) / 2 - 1, { lineBreak: false })
  })
}
