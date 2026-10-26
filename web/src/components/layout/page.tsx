import { ThemeSwitch } from '@/components/theme-switch'
import { PageHeader } from '@/components/shared/page-header'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  /** Contenido de ancho completo y altura fija (calendario). */
  fixed?: boolean
  fluid?: boolean
}

/** Estructura común de las páginas del panel: cabecera superior + título + contenido. */
export function Page({ title, description, actions, children, fixed, fluid }: PageProps) {
  return (
    <>
      <Header fixed>
        <span className='truncate text-sm font-medium text-muted-foreground md:hidden'>
          {title}
        </span>
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch />
        </div>
      </Header>
      <Main fixed={fixed} fluid={fluid}>
        <PageHeader title={title} description={description} actions={actions} />
        {children}
      </Main>
    </>
  )
}
