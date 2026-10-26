import { cn } from '@/lib/utils'

/**
 * Logotipo oficial de Supernova (archivos originales de SUPERNOVA-dev/public, copiados sin modificar a
 * /brand). Proporciones: horizontal 1892×408, isotipo 500×500.
 *  - `auto`: versión de color en modo claro y versión blanca en modo oscuro.
 *  - `white`: siempre la versión blanca (para fondos azul marino).
 *  - `mark`: isotipo «S».
 */
type Props = {
  variant?: 'auto' | 'white' | 'mark'
  className?: string
}

const SRC = {
  color: '/brand/logoSupernova.png',
  white: '/brand/logoSupernovaBlanco.png',
  mark: '/brand/logoSupernovaS.png',
}

export function BrandLogo({ variant = 'auto', className }: Props) {
  if (variant === 'mark') {
    return <img src={SRC.mark} alt='Supernova' width={500} height={500} className={cn('size-9 object-contain', className)} />
  }
  if (variant === 'white') {
    return <img src={SRC.white} alt='Supernova' width={1893} height={408} className={cn('h-7 w-auto', className)} />
  }
  return (
    <>
      <img src={SRC.color} alt='Supernova' width={1892} height={408} className={cn('h-7 w-auto dark:hidden', className)} />
      <img src={SRC.white} alt='' aria-hidden width={1893} height={408} className={cn('hidden h-7 w-auto dark:block', className)} />
    </>
  )
}
