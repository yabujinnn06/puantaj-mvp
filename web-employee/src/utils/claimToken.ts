const CLAIM_TOKEN_KEY = 'pf_pending_claim_token'
const CLAIM_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function readClaimTokenCookie(): string {
  if (typeof document === 'undefined') {
    return ''
  }

  const target = `${CLAIM_TOKEN_KEY}=`
  for (const rawPart of document.cookie.split(';')) {
    const part = rawPart.trim()
    if (!part.startsWith(target)) {
      continue
    }

    const encodedValue = part.slice(target.length)
    if (!encodedValue) {
      return ''
    }

    try {
      return decodeURIComponent(encodedValue).trim()
    } catch {
      return encodedValue.trim()
    }
  }

  return ''
}

function writeClaimTokenCookie(token: string): void {
  if (typeof document === 'undefined') {
    return
  }

  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${CLAIM_TOKEN_KEY}=${encodeURIComponent(token)};path=/;max-age=${CLAIM_TOKEN_COOKIE_MAX_AGE_SECONDS};samesite=lax${secure}`
}

function clearClaimTokenCookie(): void {
  if (typeof document === 'undefined') {
    return
  }

  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${CLAIM_TOKEN_KEY}=;path=/;max-age=0;samesite=lax${secure}`
}

export function getPendingClaimToken(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const fromCookie = readClaimTokenCookie()
  if (fromCookie) {
    window.localStorage.removeItem(CLAIM_TOKEN_KEY)
    return fromCookie
  }

  const fromStorage = (window.localStorage.getItem(CLAIM_TOKEN_KEY) ?? '').trim()
  if (!fromStorage) {
    return ''
  }

  writeClaimTokenCookie(fromStorage)
  window.localStorage.removeItem(CLAIM_TOKEN_KEY)
  return fromStorage
}

export function setPendingClaimToken(token: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const normalized = token.trim()
  if (!normalized) {
    return
  }

  writeClaimTokenCookie(normalized)
  window.localStorage.removeItem(CLAIM_TOKEN_KEY)
}

export function clearPendingClaimToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CLAIM_TOKEN_KEY)
  }
  clearClaimTokenCookie()
}
