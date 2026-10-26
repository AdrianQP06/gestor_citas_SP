import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type PDFDocument from 'pdfkit'

/**
 * Recursos de marca compartidos por todos los PDF (informes y recibos): logotipo oficial de Supernova
 * (el mismo archivo que usa la interfaz web) y tipografía Manrope.
 */
const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

export const LOGO = resolve(here, '../../../../../web/public/brand/logoSupernova.png')
export const FONT = (weight: 400 | 700 | 800) =>
  require.resolve(`@fontsource/manrope/files/manrope-latin-${weight}-normal.woff`)

export const PAGE = { w: 595.28, h: 841.89 }

/** Registra las fuentes con los alias que usan los dibujadores: M (normal), MB (negrita), MX (extranegrita). */
export function registerBrandFonts(doc: InstanceType<typeof PDFDocument>) {
  doc.registerFont('M', FONT(400))
  doc.registerFont('MB', FONT(700))
  doc.registerFont('MX', FONT(800))
}
