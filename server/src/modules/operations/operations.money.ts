/**
 * Dinero: los importes se guardan como ENTEROS en unidades menores (centavos) junto a una moneda explícita.
 * Nunca se usan decimales binarios para sumar: 0,10 + 0,20 son 10 + 20 = 30 centavos exactos.
 */
export const CURRENCIES = ['USD', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]

/** Máximo 9.999.999,99 por operación. */
export const MAX_MINOR = 999_999_999

export class MoneyError extends Error {}

/**
 * Convierte un importe escrito por una persona («50», «50.00», «50,5») en centavos enteros.
 * Solo admite un separador decimal y como máximo dos decimales; rechaza signos, notación científica,
 * miles, vacíos, cero y negativos.
 */
export function parseAmountToMinor(input: unknown): number {
  const text = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : ''
  if (!text) throw new MoneyError('Indica el importe.')
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(text)
  if (!m) {
    throw new MoneyError(
      /^[-+]/.test(text) || Number(text.replace(',', '.')) < 0
        ? 'El importe debe ser positivo.'
        : 'Importe no válido: usa números con un máximo de 2 decimales (p. ej. 50.00).'
    )
  }
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (minor <= 0) throw new MoneyError('El importe debe ser mayor que cero.')
  if (minor > MAX_MINOR) throw new MoneyError('El importe supera el máximo permitido (9.999.999,99).')
  return minor
}

/** «5000» → «50.00» (formato de intercambio de la API). */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** «5000», «USD» → «50,00 USD» (para pantalla, informes y recibos). Siempre con la moneda. */
export function formatMoney(minor: number, currency: string): string {
  return `${nf.format(minor / 100)} ${currency}`
}
