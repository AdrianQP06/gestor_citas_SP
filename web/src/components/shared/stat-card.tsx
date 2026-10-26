import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type StatCardProps = {
  label: string
  value?: number
  hint?: string
  icon: LucideIcon
  tone?: 'default' | 'warning' | 'success' | 'danger' | 'gold'
  /** Cifra destacada: único uso del acento dorado de la marca. */
  hero?: boolean
  loading?: boolean
}

const tones = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-destructive/10 text-destructive',
  gold: 'bg-gold-soft text-gold',
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  hero,
  loading,
}: StatCardProps) {
  return (
    <Card className='gap-0 py-0'>
      <CardContent className='flex items-start justify-between p-5'>
        <div className='min-w-0'>
          <p className='text-sm text-muted-foreground'>{label}</p>
          {loading ? (
            <Skeleton className='mt-2 h-8 w-14' />
          ) : (
            <p className={cn('mt-1 text-3xl font-bold tracking-tight tabular-nums', hero && 'text-gold')}>
              {value ?? 0}
            </p>
          )}
          {hint && (
            <p className='mt-1 truncate text-xs text-muted-foreground'>{hint}</p>
          )}
        </div>
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            tones[tone]
          )}
        >
          <Icon className='size-5' />
        </div>
      </CardContent>
    </Card>
  )
}
