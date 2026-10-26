import { type LinkProps } from '@tanstack/react-router'

type NavLink = {
  title: string
  url: LinkProps['to']
  icon?: React.ElementType
  badge?: string
  /** Solo se muestra a administradores. */
  adminOnly?: boolean
}

type NavGroup = {
  title: string
  items: NavLink[]
}

export type { NavGroup, NavLink }
