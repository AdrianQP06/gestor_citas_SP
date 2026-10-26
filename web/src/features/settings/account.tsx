import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { authApi } from '@/api/services'
import { applyServerErrors, changePasswordSchema, type ChangePasswordValues } from '@/validation/forms'
import { useSession } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { PasswordInput } from '@/components/password-input'
import { SettingsSection } from './components'

export function AccountSettings() {
  const { data: user } = useSession()
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })
  const save = useMutation({
    mutationFn: (v: ChangePasswordValues) => authApi.changePassword(v.currentPassword, v.newPassword),
    onSuccess: () => {
      toast.success('Contraseña actualizada. Se han cerrado tus otras sesiones.')
      form.reset()
    },
    onError: (e) => {
      if (!applyServerErrors(form, e)) toast.error(errorMessage(e))
    },
  })

  return (
    <div className='space-y-6'>
      <SettingsSection title='Mi cuenta'>
        <dl className='grid gap-3 text-sm sm:grid-cols-3'>
          <div>
            <dt className='text-muted-foreground'>Nombre</dt>
            <dd className='font-medium'>{user?.name}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Correo</dt>
            <dd className='font-medium break-all'>{user?.email}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Rol</dt>
            <dd className='font-medium'>{user?.role === 'admin' ? 'Administrador' : 'Equipo'}</dd>
          </div>
        </dl>
      </SettingsSection>

      <SettingsSection title='Cambiar contraseña' description='Al cambiarla se cierran tus sesiones abiertas en otros dispositivos.'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='max-w-sm space-y-4' noValidate>
            <FormField
              control={form.control}
              name='currentPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña actual</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='current-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='newPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nueva contraseña</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='confirm'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repite la nueva contraseña</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type='submit' disabled={save.isPending}>
              {save.isPending && <Loader2 className='animate-spin' />}
              Actualizar contraseña
            </Button>
          </form>
        </Form>
      </SettingsSection>
    </div>
  )
}
