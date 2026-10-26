import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

type ErrorScreenProps = {
  code: string
  title: string
  description: string
}

function ErrorScreen({ code, title, description }: ErrorScreenProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='flex h-svh w-full flex-col items-center justify-center gap-2 px-6 text-center'>
      <h1 className='text-[6rem] leading-tight font-bold text-primary/80'>
        {code}
      </h1>
      <span className='text-lg font-medium'>{title}</span>
      <p className='max-w-md text-muted-foreground'>{description}</p>
      <div className='mt-6 flex gap-3'>
        <Button variant='outline' onClick={() => history.go(-1)}>
          Volver
        </Button>
        <Button onClick={() => navigate({ to: '/' })}>Ir al inicio</Button>
      </div>
    </div>
  )
}

export const NotFoundError = () => (
  <ErrorScreen
    code='404'
    title='Página no encontrada'
    description='La dirección no existe o se ha movido.'
  />
)

export const GeneralError = () => (
  <ErrorScreen
    code='500'
    title='Algo ha salido mal'
    description='Ha ocurrido un error inesperado. Recarga la página; si persiste, avisa al administrador.'
  />
)
