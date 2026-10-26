import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className
      )}
    >
      <div className='mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground'>
        <Icon className='size-6' />
      </div>
      <h3 className='text-base font-medium'>{title}</h3>
      {description && (
        <p className='mt-1 max-w-sm text-sm text-muted-foreground'>
          {description}
        </p>
      )}
      {action && <div className='mt-4'>{action}</div>}
    </div>
  )
}
