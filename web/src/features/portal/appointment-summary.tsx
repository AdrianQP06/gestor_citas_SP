import { CalendarDays, Clock, FileText, MapPin, User } from 'lucide-react'
import { formatLongDate } from '@/lib/format'
import type { PublicAppointment } from '@/types/api'

function Row({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <li className='flex items-start gap-3'>
      <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      <span className='min-w-0 break-words'>{children}</span>
    </li>
  )
}

/** Resumen de una cita para el cliente (confirmación y página de gestión). */
export function AppointmentSummary({ appointment: a }: { appointment: PublicAppointment }) {
  return (
    <ul className='space-y-3 text-sm'>
      <Row icon={CalendarDays}>
        <strong>{formatLongDate(a.date)}</strong>
      </Row>
      <Row icon={Clock}>
        <span className='tabular-nums'>
          {a.time} – {a.endTime}
        </span>
      </Row>
      <Row icon={User}>
        {a.customer.fullName} · {a.customer.email}
      </Row>
      <Row icon={FileText}>{a.reason}</Row>
      {a.business.address && <Row icon={MapPin}>{a.business.address}</Row>}
    </ul>
  )
}
