import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="admin-page-header mb-5 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="admin-page-header__copy max-w-3xl">
        <span className="admin-page-header__accent" aria-hidden="true" />
        <h3 className="admin-page-header__title">{title}</h3>
        {description ? <p className="admin-page-header__description">{description}</p> : null}
      </div>
      {action ? <div className="admin-page-header__action flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}

