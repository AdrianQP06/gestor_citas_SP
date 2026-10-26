import { Info } from 'lucide-react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

type SectionProps = {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function SettingsSection({ title, description, children, footer, className }: SectionProps) {
  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className='space-y-4'>{children}</CardContent>
      {footer && <CardFooter className='justify-end gap-2'>{footer}</CardFooter>}
    </Card>
  )
}

/** Aviso para quien solo puede consultar la configuración. */
export function AdminOnlyNotice() {
  return (
    <Alert>
      <Info />
      <AlertDescription>Solo los administradores pueden modificar esta configuración.</AlertDescription>
    </Alert>
  )
}

type FieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  label: string
  description?: string
}

export function SwitchField<T extends FieldValues>({ control, name, label, description }: FieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-3'>
          <div className='space-y-0.5'>
            <FormLabel className='text-sm'>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  suffix,
  min,
  max,
}: FieldProps<T> & { suffix?: string; min?: number; max?: number }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className='flex items-center gap-2'>
            <FormControl>
              <Input
                type='number'
                inputMode='numeric'
                min={min}
                max={max}
                className='w-28'
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={Number.isFinite(field.value) ? field.value : ''}
                onChange={(e) => field.onChange(e.target.value === '' ? Number.NaN : e.target.valueAsNumber)}
              />
            </FormControl>
            {suffix && <span className='text-sm text-muted-foreground'>{suffix}</span>}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
