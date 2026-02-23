import axios from 'axios'

import type { ApiErrorShape } from '../types/api'

export interface ParsedApiError {
  code?: string
  message: string
  requestId?: string
}

const codeMessageMap: Record<string, string> = {
  INVALID_CREDENTIALS: 'Kullanici adi veya sifre hatali.',
  TOO_MANY_ATTEMPTS: 'Cok fazla deneme yaptiniz. Lutfen daha sonra tekrar deneyin.',
  INVALID_TOKEN: 'Oturum gecersiz veya suresi dolmus. Lutfen tekrar giris yapin.',
  FORBIDDEN: 'Bu islem icin yetkiniz yok.',
  INTERNAL_ERROR: 'Sunucu hatasi olustu. Lutfen tekrar deneyin.',
  MFA_REQUIRED: 'MFA kodu zorunlu. Authenticator kodunu girin.',
  INVALID_MFA_CODE: 'MFA kodu gecersiz. Tekrar deneyin.',
  MFA_SETUP_REQUIRED: 'Bu hesap icin MFA kurulumu tamamlanmamis.',
  MFA_SETUP_NOT_STARTED: 'Once MFA kurulumunu baslatin.',
  MFA_NOT_ENABLED: 'Bu hesapta MFA aktif degil.',
  ARCHIVE_DECRYPT_FAILED: 'Arsiv dosyasi acilamadi. Sunucu anahtarini kontrol edin.',
  EXTRA_CHECKIN_APPROVAL_NOT_FOUND: 'Ek giris onay talebi bulunamadi.',
  EXTRA_CHECKIN_APPROVAL_EXPIRED: 'Ek giris onay talebinin suresi dolmus.',
  INVITE_ATTEMPTS_EXCEEDED: 'Davet linkinin deneme limiti doldu. Yeni bir link uretin.',
  INVITE_CONTEXT_MISMATCH: 'Davet linki ayni cihaz/tarayici baglaminda kullanilmalidir.',
  INVITE_RETRY_TOO_FAST: 'Cok hizli deneme yaptiniz. Birkac saniye bekleyip tekrar deneyin.',
  INVITE_TTL_TOO_LONG: 'Davet suresi izin verilen limiti asiyor.',
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
