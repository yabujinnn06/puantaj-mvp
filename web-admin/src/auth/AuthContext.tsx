import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { getAdminMe, loginAdmin, logoutAdmin, refreshAdminToken } from '../api/admin'
import type { AdminMeResponse } from '../types/api'
import { clearAuthTokens, getAccessToken, getRefreshToken, isTokenValid, setAuthTokens } from './token'

interface AuthContextValue {
  user: AdminMeResponse | null
  isAuthenticated: boolean
  isBootstrapping: boolean
  isSuperAdmin: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<boolean>
  hasPermission: (permission: string, mode?: 'read' | 'write') => boolean
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminMeResponse | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const markLoggedOut = useCallback(() => {
    clearAuthTokens()
    setUser(null)
  }, [])

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      markLoggedOut()
      return false
    }

    try {
      const refreshed = await refreshAdminToken({ refresh_token: refreshToken })
      setAuthTokens(refreshed.access_token, refreshed.refresh_token ?? refreshToken)
      const profile = await getAdminMe()
      setUser(profile)
      return true
    } catch {
      markLoggedOut()
      return false
    }
  }, [markLoggedOut])

  const bootstrap = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setUser(null)
      setIsBootstrapping(false)
      return
    }

    if (isTokenValid(token)) {
      try {
        const profile = await getAdminMe()
        setUser(profile)
      } catch {
        await refreshSession()
      } finally {
        setIsBootstrapping(false)
      }
      return
    }

    await refreshSession()
    setIsBootstrapping(false)
  }, [refreshSession])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const onForcedLogout = () => {
      setUser(null)
    }

    window.addEventListener('auth:logout', onForcedLogout)
    return () => {
      window.removeEventListener('auth:logout', onForcedLogout)
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const auth = await loginAdmin({ username, password })
    setAuthTokens(auth.access_token, auth.refresh_token)
    const profile = await getAdminMe()
    setUser(profile)
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      try {
        await logoutAdmin({ refresh_token: refreshToken })
      } catch {
        // best-effort logout
      }
    }

    markLoggedOut()
  }, [markLoggedOut])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isBootstrapping,
      isSuperAdmin: Boolean(user?.is_super_admin),
      login,
      logout,
      refreshSession,
      hasPermission: (permission: string, mode: 'read' | 'write' = 'read') => {
        if (!user) {
          return false
        }
        if (user.is_super_admin) {
          return true
        }
        const current = user.permissions?.[permission]
        if (!current) {
          return false
        }
        if (mode === 'write') {
          return Boolean(current.write)
        }
        return Boolean(current.read || current.write)
      },
    }),
    [user, isBootstrapping, login, logout, refreshSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
