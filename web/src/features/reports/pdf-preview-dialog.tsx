import { useEffect, useState } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  previewUrl: string
  downloadUrl: string
}

/**
 * Vista previa del PDF generado por el backend con los mismos filtros de la pantalla.
 * Se muestra en un iframe de la propia aplicación (la sesión viaja por cookie).
 */
export function PdfPreviewDialog({ open, onOpenChange, title, previewUrl, downloadUrl }: Props) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState<string | null>(null)
  const loading = loadedUrl !== previewUrl && gaveUp !== previewUrl

  // Algunos navegadores (p. ej. móviles) no muestran PDF en línea y el iframe nunca termina de «cargar».
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setGaveUp(previewUrl), 8000)
    return () => clearTimeout(t)
  }, [open, previewUrl])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90svh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Vista previa del PDF</DialogTitle>
          <DialogDescription>{title}. Es exactamente el documento que se descargará.</DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted text-sm text-muted-foreground">
              <Loader2 className="animate-spin" /> Generando el informe…
            </div>
          )}
          {open && <iframe title={`Vista previa: ${title}`} src={previewUrl} className="size-full" onLoad={() => setLoadedUrl(previewUrl)} />}
        </div>
        <p className="text-xs text-muted-foreground">
          ¿No se ve la vista previa? Tu navegador puede no admitir PDF en línea: usa «Abrir en otra pestaña» o «Descargar PDF».
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <a href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Abrir en otra pestaña
            </a>
          </Button>
          <Button asChild>
            <a href={downloadUrl}>
              <Download /> Descargar PDF
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
