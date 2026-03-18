const ACCESS_TOKEN_KEY = 'puantaj_access_token'
const REFRESH_TOKEN_KEY = 'puantaj_refresh_token'

interface TokenPayload {
  exp?: number
}

interface LegacyAuthTokens {
  accessToken: string | null
  refreshToken: string | null
}

let sessionAccessToken: string | null = null

function readLegacyAdminToken(key: string): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null
  }

  const value = (localStorage.getItem(key) ?? '').trim()
  return value || null
}

function clearLegacyAdminTokenStorage(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function getAccessToken(): string | null {
  return sessionAccessToken
}

export function getLegacyAuthTokens(): LegacyAuthTokens {
  return {
    accessToken: readLegacyAdminToken(ACCESS_TOKEN_KEY),
    refreshToken: readLegacyAdminToken(REFRESH_TOKEN_KEY),
  }
}

export function clearLegacyAuthTokens(): void {
  clearLegacyAdminTokenStorage()
}

export function setAuthTokens(accessToken: string, _refreshToken?: string | null): void {
  sessionAccessToken = accessToken.trim() || null
  clearLegacyAdminTokenStorage()
}

export function clearAuthTokens(): void {
  sessionAccessToken = null
  clearLegacyAdminTokenStorage()
}

function decodePayload(token: string): TokenPayload | null {
  try {
    const payloadPart = token.split('.')[1]
    if (!payloadPart) {
      return null
    }

    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const parsed = JSON.parse(atob(padded)) as TokenPayload
    return parsed
  } catch {
    return null
  }
}

export function isTokenValid(token: string | null): boolean {
  if (!token) {
    return false
  }
  const payload = decodePayload(token)
  if (!payload?.exp) {
    return false
  }
  const nowSec = Math.floor(Date.now() / 1000)
  return payload.exp > nowSec + 10
}
