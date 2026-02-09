import axios from 'axios'

import type { ApiErrorShape } from '../types/api'

export interface ParsedApiError {
  code?: string
  message: string
  requestId?: string
}

const codeMessageMap: Record<string, string> = {
  INVALID_CREDENTIALS: 'Kullanıcı adi veya Şifre hatali.',
  TOO_MANY_ATTEMPTS: 'Cok fazla deneme yaptiniz. Lutfen daha sonra tekrar deneyin.',
  INVALID_TOKEN: 'Oturum gecersiz veya suresi dolmus. Lutfen tekrar giriş yapin.',
  FORBIDDEN: 'Bu islem için yetkiniz yok.',
  INTERNAL_ERROR: 'Sunucu hatasi olustu. Lutfen tekrar deneyin.',
}

export function parseApiError(error: unknown, fallback: string): ParsedApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiErrorShape | string | undefined
    if (typeof data === 'string') {
      return { message: data }
    }

    const code = data?.error?.code
    const requestId = data?.error?.request_id
    const backendMessage = data?.error?.message

    if (code && codeMessageMap[code]) {
      return {
        code,
        requestId,
        message: codeMessageMap[code],
      }
    }

    if (backendMessage) {
      return {
        code,
        requestId,
        message: backendMessage,
      }
    }

    if (error.message) {
      return {
        message: error.message,
      }
    }
  }

  if (error instanceof Error && error.message) {
    return {
      message: error.message,
    }
  }

  return {
    message: fallback,
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return parseApiError(error, fallback).message
}
