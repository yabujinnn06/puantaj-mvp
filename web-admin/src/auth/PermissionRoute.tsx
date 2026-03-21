import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { getFirstAccessibleAdminPath } from '../config/adminNavigation'
import { useAuth } from '../hooks/useAuth'

export function DefaultAdminRoute() {
  const { hasPermission } = useAuth()
  const target = getFirstAccessibleAdminPath(hasPermission) ?? '/login'
  return <Navigate to={target} replace />
}

export function PermissionRoute({
  permission,
  mode = 'read',
  children,
}: {
  permission: string
  mode?: 'read' | 'write'
  children: ReactNode
}) {
  const location = useLocation()
  const { hasPermission } = useAuth()

  if (hasPermission(permission, mode)) {
    return <>{children}</>
  }

  const fallback = getFirstAccessibleAdminPath(hasPermission)
  if (fallback && fallback !== location.pathname) {
    return <Navigate to={fallback} replace />
  }

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-6 text-sm text-amber-900 shadow-sm">
      Bu sayfayı görmek için gerekli admin yetkisi bulunamadı.
    </div>
  )
}
