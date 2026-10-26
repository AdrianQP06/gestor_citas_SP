import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Pencil, Plus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import { usersApi } from '@/api/services'
import { applyServerErrors, passwordRule, userSchema } from '@/validation/forms'
import type { TeamUser } from '@/types/api'
import { useSession } from '@/hooks/use-session'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from './components'

const editSchema = z.object({
  name: z.string().trim().min(2, 'Indica el nombre.').max(80),
  role: z.enum(['admin', 'staff']),
  active: z.boolean(),
  password: z.union([z.literal(''), passwordRule]),
})
type EditValues = z.infer<typeof editSchema>
type CreateValues = z.infer<typeof userSchema>

const roleLabel = (r: string) => (r === 'admin' ? 'Administrador' : 'Equipo')

export function TeamSettings() {
  const { data: me } = useSession()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const [editing, setEditing] = useState<TeamUser | 'new' | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  return (
    <SettingsSection
      title='Equipo'
      description='Personas con acceso al panel. Los administradores gestionan la configuración; el equipo gestiona las citas.'
      footer={
        <Button onClick={() => setEditing('new')}>
          <Plus /> Añadir persona
        </Button>
      }
    >
      {isLoading && <Skeleton className='h-32 w-full' />}
      {!!data?.length && (
        <ul className='divide-y rounded-lg border'>
          {data.map((u) => (
            <li key={u.id} className='flex flex-wrap items-center gap-3 p-3'>
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>
                  {u.name} {u.id === me?.id && <span className='text-xs text-muted-foreground'>(tú)</span>}
                </p>
                <p className='truncate text-sm text-muted-foreground'>{u.email}</p>
              </div>
              <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{roleLabel(u.role)}</Badge>
              {!u.active && <Badge variant='outline'>Desactivado</Badge>}
              <Button variant='ghost' size='icon' onClick={() => setEditing(u)} aria-label={`Editar a ${u.name}`}>
                <Pencil className='size-4' />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing === 'new' && <CreateDialog onOpenChange={() => setEditing(null)} onSaved={refresh} />}
      {editing && editing !== 'new' && (
        <EditDialog user={editing} isSelf={editing.id === me?.id} onOpenChange={() => setEditing(null)} onSaved={refresh} />
      )}
    </SettingsSection>
  )
}

function CreateDialog({ onOpenChange, onSaved }: { onOpenChange: () => void; onSaved: () => void }) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: '', email: '', password: '', role: 'staff' },
  })
  const save = useMutation({
    mutationFn: (v: CreateValues) => usersApi.create(v),
    onSuccess: () => {
      toast.success('Usuario creado.')
      onSaved()
      onOpenChange()
    },
    onError: (e) => {
      if (!applyServerErrors(form, e)) toast.error(errorMessage(e))
    },
  })
  const role = useWatch({ control: form.control, name: 'role' })
  return (
    <Dialog open onOpenChange={(o) => !save.isPending && !o && onOpenChange()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Nueva persona</DialogTitle>
          <DialogDescription>Compárteles la contraseña inicial por un canal seguro; podrán cambiarla en «Mi cuenta».</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-4' noValidate>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo electrónico</FormLabel>
                  <FormControl>
                    <Input type='email' autoComplete='off' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña inicial</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormDescription>Mínimo 8 caracteres, con letras y números.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>Rol</FormLabel>
              <div className='grid grid-cols-2 gap-2'>
                {(['staff', 'admin'] as const).map((r) => (
                  <Button
                    key={r}
                    type='button'
                    variant={role === r ? 'default' : 'outline'}
                    onClick={() => form.setValue('role', r)}
                    aria-pressed={role === r}
                  >
                    {roleLabel(r)}
                  </Button>
                ))}
              </div>
            </FormItem>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onOpenChange} disabled={save.isPending}>
                Cancelar
              </Button>
              <Button type='submit' disabled={save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                Crear usuario
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({
  user,
  isSelf,
  onOpenChange,
  onSaved,
}: {
  user: TeamUser
  isSelf: boolean
  onOpenChange: () => void
  onSaved: () => void
}) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: user.name, role: user.role, active: user.active, password: '' },
  })
  const save = useMutation({
    mutationFn: (v: EditValues) =>
      usersApi.update(user.id, {
        name: v.name,
        role: v.role,
        active: v.active,
        ...(v.password ? { password: v.password } : {}),
      }),
    onSuccess: () => {
      toast.success('Usuario actualizado.')
      onSaved()
      onOpenChange()
    },
    onError: (e) => {
      if (!applyServerErrors(form, e)) toast.error(errorMessage(e))
    },
  })
  const role = useWatch({ control: form.control, name: 'role' })

  return (
    <Dialog open onOpenChange={(o) => !save.isPending && !o && onOpenChange()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Editar a {user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className='space-y-4' noValidate>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>Rol</FormLabel>
              <div className='grid grid-cols-2 gap-2'>
                {(['staff', 'admin'] as const).map((r) => (
                  <Button
                    key={r}
                    type='button'
                    variant={role === r ? 'default' : 'outline'}
                    onClick={() => form.setValue('role', r, { shouldDirty: true })}
                    disabled={isSelf}
                    aria-pressed={role === r}
                  >
                    {roleLabel(r)}
                  </Button>
                ))}
              </div>
            </FormItem>
            <FormField
              control={form.control}
              name='active'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <FormLabel>Acceso activo</FormLabel>
                    <FormDescription>
                      {isSelf ? 'No puedes desactivar tu propia cuenta.' : 'Si se desactiva, se cierran sus sesiones.'}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isSelf} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-1.5'>
                    <KeyRound className='size-3.5' /> Restablecer contraseña (opcional)
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' placeholder='Dejar vacío para no cambiarla' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onOpenChange} disabled={save.isPending}>
                Cancelar
              </Button>
              <Button type='submit' disabled={save.isPending}>
                {save.isPending && <Loader2 className='animate-spin' />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
