import { Copy, ExternalLink, Mail, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { whatsappShareUrl } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

type Props = { url?: string; enabled?: boolean; businessName?: string }

export function PortalLinkCard({ url, enabled, businessName }: Props) {
  const message = `Reserva tu cita en ${businessName ?? 'nuestro negocio'} cuando quieras: ${url}`

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Enlace copiado.')
    } catch {
      toast.error('No se pudo copiar. Selecciónalo manualmente.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enlace de reservas</CardTitle>
        <CardDescription>
          Compártelo por WhatsApp, correo o redes. Tus clientes reservan sin crear cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {!url ? (
          <Skeleton className='h-9 w-full' />
        ) : (
          <div className='flex gap-2'>
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label='Enlace público de reservas' />
            <Button variant='outline' size='icon' onClick={copy} aria-label='Copiar enlace'>
              <Copy />
            </Button>
          </div>
        )}
        {enabled === false && (
          <p className='text-sm text-destructive'>
            El portal está desactivado: los clientes verán un aviso en lugar del calendario.
          </p>
        )}
        <div className='grid grid-cols-3 gap-2'>
          <Button variant='outline' size='sm' asChild disabled={!url}>
            <a href={whatsappShareUrl(message)} target='_blank' rel='noreferrer'>
              <MessageCircle /> WhatsApp
            </a>
          </Button>
          <Button variant='outline' size='sm' asChild disabled={!url}>
            <a
              href={`mailto:?subject=${encodeURIComponent('Reserva tu cita')}&body=${encodeURIComponent(message)}`}
            >
              <Mail /> Correo
            </a>
          </Button>
          <Button variant='outline' size='sm' asChild disabled={!url}>
            <a href={url} target='_blank' rel='noreferrer'>
              <ExternalLink /> Abrir
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
