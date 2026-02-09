import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { clearAuthTokens, getAccessToken, getRefreshToken, setAuthTokens } from '../auth/token'
import { parseApiError } from './error'
import type { AdminAuthResponse } from '../types/api'

const defaultBaseURL =
  typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8000'
const configuredBaseURL = import.meta.env.VITE_API_BASE_URL
const isConfiguredLocalhost =
  !!configuredBaseURL &&
  (configuredBaseURL.includes('127.0.0.1') || configuredBaseURL.includes('localhost'))
const isRemoteRuntime =
  typeof window !== 'undefined' &&
  window.location.hostname !== '127.0.0.1' &&
  window.location.hostname !== 'localhost'

const baseURL =
  isRemoteRuntime && isConfiguredLocalhost ? window.location.origin : configuredBaseURL ?? defaultBaseURL
const appBaseUrl = import.meta.env.BASE_URL ?? '/'
const appBasePrefix =
  appBaseUrl === '/' ? '' : appBaseUrl.endsWith('/') ? appBaseUrl.slice(0, -1) : appBaseUrl

export const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
})

function forceLogoutAndRedirect(): void {
  clearAuthTokens()

  if (typeof window === 'undefined') {
    return
  }

  const absolutePath = `${window.location.pathname}${window.location.search}`
  const relativePath =
    appBasePrefix && absolutePath.startsWith(appBasePrefix)
      ? absolutePath.slice(appBasePrefix.length) || '/'
      : absolutePath

  if (relativePath === '/login' || relativePath.startsWith('/login?')) {
    window.dispatchEvent(new Event('auth:logout'))
    return
  }

  const loginUrl = `${appBasePrefix}/login?redirect=${encodeURIComponent(relativePath)}`
  window.location.replace(loginUrl)
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function requestTokenRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    forceLogoutAndRedirect()
    return null
  }

  try {
    const response = await axios.post<AdminAuthResponse>(`${baseURL}/api/admin/auth/refresh`, {
      refresh_token: refreshToken,
    })

    setAuthTokens(response.data.access_token, response.data.refresh_token ?? refreshToken)
    return response.data.access_token
  } catch {
    forceLogoutAndRedirect()
    return null
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    if (!originalRequest) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const parsedError = parseApiError(error, 'Request failed')
    const code = parsedError.code

    if (status !== 401 || code !== 'INVALID_TOKEN' || originalRequest._retry) {
      return Promise.reject(error)
    }

    const requestUrl = originalRequest.url ?? ''
    const isAuthCall =
      requestUrl.includes('/api/admin/auth/login') ||
      requestUrl.includes('/api/admin/auth/refresh') ||
      requestUrl.includes('/api/admin/auth/logout')

    if (isAuthCall) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    if (!refreshPromise) {
      refreshPromise = requestTokenRefresh().finally(() => {
        refreshPromise = null
      })
    }

    const freshToken = await refreshPromise
    if (!freshToken) {
      return Promise.reject(error)
    }

    originalRequest.headers.Authorization = `Bearer ${freshToken}`
    return apiClient(originalRequest)
  },
)
