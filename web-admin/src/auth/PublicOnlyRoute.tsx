import { Navigate, Outlet } from 'react-router-dom'

import { getFirstAccessibleAdminPath } from '../config/adminNavigation'
import { useAuth } from '../hooks/useAuth'

export function PublicOnlyRoute() {
  const { hasPermission, isAuthenticated, isBootstrapping } = useAuth()

  if (isBootstrapping) {
    return <div className="flex min-h-screen items-center justify-center text-slate-600">Yükleniyor...</div>
  }

  if (isAuthenticated) {
    return <Navigate to={getFirstAccessibleAdminPath(hasPermission) ?? '/log'} replace />
  }

  return <Outlet />
}
