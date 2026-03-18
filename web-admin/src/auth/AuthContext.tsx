import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { getAdminMe, loginAdmin, logoutAdmin, refreshAdminToken } from '../api/admin'
import type { AdminMeResponse, AdminPermissionValue } from '../types/api'
import {
  clearAuthTokens,
  clearLegacyAuthTokens,
  getLegacyAuthTokens,
  isTokenValid,
  setAuthTokens,
} from './token'

const LEGACY_PERMISSION_FALLBACKS: Record<string, readonly string[]> = {
  log: ['employees'],
  qr_codes: ['schedule'],
  notifications: ['audit'],
  audit_logs: ['audit'],
}

function getPermissionEntry(
  permissions: AdminMeResponse['permissions'] | null | undefined,
  permission: string,
): AdminPermissionValue | null {
  if (!permissions || !Object.prototype.hasOwnProperty.call(permissions, permission)) {
    return null
  }
  return permissions[permission] ?? null
}

function resolvePermissionEntry(
  permissions: AdminMeResponse['permissions'] | null | undefined,
  permission: string,
): AdminPermissionValue | null {
  const direct = getPermissionEntry(permissions, permission)
  if (direct) {
    return direct
  }

  const fallbackKeys = LEGACY_PERMISSION_FALLBACKS[permission]
  if (!fallbackKeys) {
    return null
  }

  for (const fallbackKey of fallbackKeys) {
    const fallback = getPermissionEntry(permissions, fallbackKey)
    if (fallback) {
      return fallback
    }
  }

  return null
}

interface AuthContextValue {
  user: AdminMeResponse | null
  isAuthenticated: boolean
  isBootstrapping: boolean
  isSuperAdmin: boolean
  login: (
    username: string,
    password: string,
    mfaCode?: string,
    mfaRecoveryCode?: string,
  ) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<boolean>
  hasPermission: (permission: string, mode?: 'read' | 'write') => boolean
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminMeResponse | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const markLoggedOut = useCallback(() => {
    clearAuthTokens()
    setUser(null)
  }, [])

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const refreshed = await refreshAdminToken()
      setAuthTokens(refreshed.access_token, refreshed.refresh_token ?? null)
      const profile = await getAdminMe()
      clearLegacyAuthTokens()
      setUser(profile)
      return true
    } catch {
      markLoggedOut()
      return false
    }
  }, [markLoggedOut])

  const bootstrap = useCallback(async () => {
    const legacyTokens = getLegacyAuthTokens()

    if (legacyTokens.refreshToken) {
      try {
        const refreshed = await refreshAdminToken({ refresh_token: legacyTokens.refreshToken })
        setAuthTokens(refreshed.access_token, refreshed.refresh_token ?? null)
        const profile = await getAdminMe()
        clearLegacyAuthTokens()
        setUser(profile)
        setIsBootstrapping(false)
        return
      } catch {
        // Fall back to any still-valid legacy access token before forcing a re-login.
      }
    }

    if (legacyTokens.accessToken && isTokenValid(legacyTokens.accessToken)) {
      setAuthTokens(legacyTokens.accessToken)
    } else {
      clearAuthTokens()
    }

    try {
      const profile = await getAdminMe()
      clearLegacyAuthTokens()
      setUser(profile)
    } catch {
      await refreshSession()
    } finally {
      setIsBootstrapping(false)
    }
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

  const login = useCallback(async (username: string, password: string, mfaCode?: string, mfaRecoveryCode?: string) => {
    const auth = await loginAdmin({
      username,
      password,
      mfa_code: mfaCode?.trim() || undefined,
      mfa_recovery_code: mfaRecoveryCode?.trim() || undefined,
    })
    setAuthTokens(auth.access_token, auth.refresh_token ?? null)
    const profile = await getAdminMe()
    setUser(profile)
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutAdmin()
    } catch {
      // best-effort logout
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
        const current = resolvePermissionEntry(user.permissions, permission)
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
