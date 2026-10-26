import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { CalendarCheck, Loader2, ShieldCheck, Bell, Clock } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { authApi } from '@/api/services'
import { errorMessage } from '@/api/client'
import { loginSchema, type LoginValues } from '@/validation/forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { BrandLogo } from '@/components/brand/logo'
import { PasswordInput } from '@/components/password-input'

const highlights = [
  { icon: Clock, text: 'Agenda diaria, semanal y mensual en un vistazo' },
  { icon: CalendarCheck, text: 'Portal público para que tus clientes reserven solos' },
  { icon: Bell, text: 'Recordatorios por WhatsApp 20 minutos antes' },
  { icon: ShieldCheck, text: 'Datos de clientes protegidos y con registro de actividad' },
]

/** Solo se aceptan rutas internas como destino tras iniciar sesión (evita redirecciones abiertas). */
const safeRedirect = (value?: string) =>
  value && value.startsWith('/') && !value.startsWith('//') ? value : '/'

export function SignInPage() {
  const { redirect } = useSearch({ from: '/sign-in' })
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const login = useMutation({
    mutationFn: (v: LoginValues) => authApi.login(v.email, v.password),
    onSuccess: (user) => {
      queryClient.setQueryData(['session'], user)
      const target = safeRedirect(redirect)
      if (target === '/') navigate({ to: '/', replace: true })
      else router.history.replace(target)
    },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <div className='grid min-h-svh lg:grid-cols-2'>
      {/* Panel de marca: azul marino oficial de Supernova en ambos temas, con el logotipo blanco. */}
      <div className='relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-white lg:flex'>
        <div className='absolute -top-24 -right-24 size-96 rounded-full bg-[#5a5acb]/25 blur-3xl' />
        <div className='absolute -bottom-32 -left-16 size-96 rounded-full bg-[#000123]/60 blur-3xl' />
        <div className='relative'>
          <BrandLogo variant='white' className='h-9' />
          <p className='mt-2 text-xs font-medium tracking-wide text-white/60 uppercase'>Gestor de citas</p>
        </div>
        <div className='relative space-y-6'>
          <h2 className='max-w-md text-3xl leading-tight font-bold'>
            Las citas de Supernova, <span className='text-gold-light'>siempre en orden</span>.
          </h2>
          <ul className='space-y-3 text-sm text-white/85'>
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className='flex items-center gap-3'>
                <Icon className='size-4 shrink-0 text-gold-light' />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className='relative text-xs text-white/60'>Acceso reservado al personal autorizado.</p>
      </div>

      <div className='flex items-center justify-center p-6'>
        <div className='w-full max-w-sm space-y-6'>
          <div className='lg:hidden'>
            <BrandLogo className='h-8' />
          </div>
          <div className='space-y-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Iniciar sesión</h1>
            <p className='text-sm text-muted-foreground'>
              Accede al panel de gestión de citas.
            </p>
          </div>

          {error && (
            <Alert variant='destructive' role='alert'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => {
                setError(null)
                login.mutate(v)
              })}
              className='space-y-4'
              noValidate
            >
              <FormField
                control={form.control}
                name='email'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input
                        type='email'
                        autoComplete='username'
                        placeholder='tu@empresa.com'
                        autoFocus
                        {...field}
                      />
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
                    <FormLabel>Contraseña</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete='current-password'
                        placeholder='••••••••'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type='submit' className='w-full' disabled={login.isPending}>
                {login.isPending && <Loader2 className='animate-spin' />}
                Entrar
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  )
}
