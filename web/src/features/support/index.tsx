import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Check, Inbox, Loader2, MessageCircle, Phone, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { supportApi } from '@/api/services'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SupportRequest, SupportStatus } from '@/types/api'
import { useTimezone } from '@/hooks/use-settings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/shared/empty-state'

const STATUS_STYLE: Record<SupportStatus, string> = {
  pending: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  attended: 'border-success/40 bg-success/15 text-emerald-700 dark:text-emerald-300',
  closed: 'border-border bg-muted text-muted-foreground',
}
const digits = (phone: string) => phone.replace(/\D/g, '')

type Pending = { request: SupportRequest; kind: 'attend' | 'close' }

/** Bandeja interna de solicitudes de atención. El contacto con la persona es manual (teléfono o WhatsApp). */
export function SupportInboxPage() {
  const { status } = useSearch({ from: '/_authenticated/support' })
  const navigate = useNavigate({ from: '/support' })
  const timezone = useTimezone()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Pending | null>(null)
  const [note, setNote] = useState('')

  const list = useQuery({ queryKey: ['support', 'list', status ?? 'all'], queryFn: () => supportApi.list(status) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['support'] })

  const resolve = useMutation({
    mutationFn: ({ request, kind }: Pending) =>
      kind === 'attend' ? supportApi.attend(request.id, note.trim() || undefined) : supportApi.close(request.id, note.trim()),
    onSuccess: (_r, v) => {
      toast.success(v.kind === 'attend' ? 'Solicitud marcada como atendida.' : 'Solicitud cerrada.')
      setAction(null)
      setNote('')
      return refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const tab = status ?? 'all'
  const data = list.data

  return (
    <Page
      title='Atención al cliente'
      description='Solicitudes enviadas desde el portal de reservas. La aplicación solo las registra: contacta a la persona tú mismo y marca el resultado.'
    >
      <div className='space-y-4'>
        <Tabs value={tab} onValueChange={(v) => navigate({ search: v === 'all' ? {} : { status: v as SupportStatus }, replace: true })}>
          <TabsList>
            <TabsTrigger value='all'>Todas</TabsTrigger>
            <TabsTrigger value='pending'>
              Pendientes{data && data.pending > 0 ? <Badge className='ms-2'>{data.pending}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value='attended'>Atendidas</TabsTrigger>
            <TabsTrigger value='closed'>Cerradas</TabsTrigger>
          </TabsList>
        </Tabs>

        {list.isLoading && <Skeleton className='h-40 w-full' />}
        {list.isError && <p className='text-sm text-destructive'>{errorMessage(list.error)}</p>}
        {data && data.requests.length === 0 && (
          <EmptyState icon={Inbox} title='No hay solicitudes' description='Cuando alguien pida atención desde el portal aparecerá aquí.' />
        )}

        <ul className='space-y-3'>
          {data?.requests.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className='space-y-3 p-4'>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <p className='font-semibold'>{r.fullName}</p>
                      <p className='text-sm text-muted-foreground'>
                        {r.reasonLabel} · {formatDateTime(r.createdAt, timezone)}
                      </p>
                    </div>
                    <Badge variant='outline' className={cn('font-medium', STATUS_STYLE[r.status])}>
                      {r.statusLabel}
                    </Badge>
                  </div>
                  {r.message && <p className='rounded-md bg-muted/50 p-2 text-sm break-words'>{r.message}</p>}
                  <div className='flex flex-wrap items-center gap-3 text-sm'>
                    <a href={`tel:${r.phone}`} className='inline-flex items-center gap-1 hover:underline'>
                      <Phone className='size-4' /> {r.phone}
                    </a>
                    <a href={`https://wa.me/${digits(r.phone)}`} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-primary hover:underline'>
                      <MessageCircle className='size-4' /> Abrir WhatsApp
                    </a>
                  </div>
                  {r.status === 'pending' ? (
                    <div className='flex flex-wrap justify-end gap-2'>
                      <Button size='sm' variant='ghost' onClick={() => setAction({ request: r, kind: 'close' })}>
                        <X /> Cerrar sin atender
                      </Button>
                      <Button size='sm' onClick={() => setAction({ request: r, kind: 'attend' })}>
                        <Check /> Marcar como atendida
                      </Button>
                    </div>
                  ) : (
                    <p className='text-xs text-muted-foreground'>
                      {r.status === 'attended' ? 'Atendida' : 'Cerrada'} por {r.handledBy}
                      {r.handledAt ? ` · ${formatDateTime(r.handledAt, timezone)}` : ''}
                      {r.staffNote ? ` · Nota: ${r.staffNote}` : ''}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setAction(null)
              setNote('')
            }
          }}
          title={action.kind === 'attend' ? 'Marcar como atendida' : 'Cerrar sin atender'}
          desc={
            action.kind === 'attend'
              ? `Confirma que ya has contactado o atendido a ${action.request.fullName}. Quedará registrado con tu nombre y la hora.`
              : `La solicitud de ${action.request.fullName} se cerrará sin atenderse (por ejemplo, duplicada o sin respuesta). No admite cambios después.`
          }
          confirmText={action.kind === 'attend' ? 'Marcar como atendida' : 'Cerrar solicitud'}
          cancelBtnText='Volver'
          destructive={action.kind === 'close'}
          isLoading={resolve.isPending}
          disabled={action.kind === 'close' && note.trim().length < 3}
          handleConfirm={() => resolve.mutate(action)}
        >
          <div className='space-y-2'>
            <Label htmlFor='support-note'>{action.kind === 'attend' ? 'Nota (opcional)' : 'Motivo del cierre (obligatorio)'}</Label>
            <Textarea id='support-note' rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {resolve.isPending && <Loader2 className='size-4 animate-spin' />}
          </div>
        </ConfirmDialog>
      )}
    </Page>
  )
}
