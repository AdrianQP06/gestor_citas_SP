import { MapPin, Phone } from 'lucide-react'
import { BrandLogo } from '@/components/brand/logo'
import { ThemeSwitch } from '@/components/theme-switch'
import type { PublicInfo } from '@/types/api'

type Props = { info?: PublicInfo; children: React.ReactNode }

/** Marco del portal público: la reserva se percibe como hecha directamente con Supernova. */
export function PortalShell({ info, children }: Props) {
  return (
    <div className='min-h-svh bg-page'>
      <header className='border-b bg-background'>
        <div className='mx-auto flex h-16 max-w-4xl items-center gap-3 px-4'>
          <a href='/reservar' className='flex min-w-0 items-center' aria-label='Supernova · Reservas online'>
            <BrandLogo className='h-7 sm:h-8' />
          </a>
          <span className='ms-1 hidden h-6 w-px bg-border sm:block' />
          <p className='hidden text-sm font-medium text-muted-foreground sm:block'>Reservas online</p>
          <div className='ms-auto'>
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <main className='mx-auto max-w-4xl px-4 py-8 sm:py-10'>{children}</main>
      <footer className='mx-auto max-w-4xl px-4 pb-10 text-sm text-muted-foreground'>
        {info && (info.address || info.phone) && (
          <div className='mb-4 flex flex-wrap gap-x-6 gap-y-1'>
            {info.address && (
              <span className='inline-flex items-center gap-1.5'>
                <MapPin className='size-4' /> {info.address}
              </span>
            )}
            {info.phone && (
              <span className='inline-flex items-center gap-1.5'>
                <Phone className='size-4' /> {info.phone}
              </span>
            )}
          </div>
        )}
        <p className='text-xs'>© {new Date().getFullYear()} Supernova · Reservas online</p>
      </footer>
    </div>
  )
}
