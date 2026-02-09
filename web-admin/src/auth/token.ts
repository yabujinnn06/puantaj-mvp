const ACCESS_TOKEN_KEY = 'puantaj_access_token'
const REFRESH_TOKEN_KEY = 'puantaj_refresh_token'

interface TokenPayload {
  exp?: number
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    return
  }
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function clearAuthTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
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

