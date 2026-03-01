import type {
  AttendanceEvent,
  ControlRoomEmployeeState,
  ControlRoomRiskStatus,
  LocationStatus,
  NotificationAudience,
  NotificationJobStatus,
  NotificationRiskLevel,
} from '../../types/api'

export const ISTANBUL_TIMEZONE = 'Europe/Istanbul'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: 'medium',
  }).format(new Date(value))
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'Veri yok'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return '-'
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return 'Şimdi'
  if (minutes < 60) return `${minutes} dk önce`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa önce`
  return `${Math.floor(hours / 24)} gün önce`
}

export function formatClockMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-'
  const normalized = Math.max(0, Math.round(value))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function riskStatusLabel(value: ControlRoomRiskStatus): string {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'WATCH') return 'İzlemeli'
  return 'Normal'
}

export function todayStatusLabel(value: ControlRoomEmployeeState['today_status']): string {
  if (value === 'IN_PROGRESS') return 'Aktif vardiya'
  if (value === 'FINISHED') return 'Gün kapandı'
  return 'Giriş yok'
}

export function locationStatusLabel(value: LocationStatus): string {
  if (value === 'VERIFIED_HOME') return 'Doğrulandı'
  if (value === 'UNVERIFIED_LOCATION') return 'Sapma'
  return 'Konum yok'
}

export function locationStateLabel(value: ControlRoomEmployeeState['location_state']): string {
  if (value === 'LIVE') return 'Canlı'
  if (value === 'STALE') return 'Yakın'
  if (value === 'DORMANT') return 'Eski'
  return 'Veri yok'
}

export function riskClass(value: ControlRoomRiskStatus | NotificationRiskLevel | null | undefined): string {
  if (value === 'CRITICAL' || value === 'Kritik') return 'is-critical'
  if (value === 'WATCH' || value === 'Uyari') return 'is-watch'
  return 'is-normal'
}

export function systemStatusLabel(value: 'HEALTHY' | 'ATTENTION' | 'CRITICAL'): string {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'ATTENTION') return 'İzlemeli'
  return 'Stabil'
}

export function systemStatusClass(value: 'HEALTHY' | 'ATTENTION' | 'CRITICAL'): string {
  if (value === 'CRITICAL') return 'is-critical'
  if (value === 'ATTENTION') return 'is-watch'
  return 'is-normal'
}

export function sortIcon(active: boolean, dir: 'asc' | 'desc'): string {
  if (!active) return '↕'
  return dir === 'asc' ? '↑' : '↓'
}

export function eventTypeLabel(value: AttendanceEvent['type']): string {
  return value === 'IN' ? 'Giriş' : 'Çıkış'
}

export function eventSourceLabel(value: AttendanceEvent['source']): string {
  return value === 'MANUAL' ? 'Manuel' : 'Cihaz'
}

export function notificationAudienceLabel(value: NotificationAudience | null | undefined): string {
  if (value === 'admin') return 'Yönetim'
  if (value === 'employee') return 'Çalışan'
  return 'Belirtilmedi'
}

export function notificationStatusLabel(value: NotificationJobStatus): string {
  if (value === 'PENDING') return 'Bekliyor'
  if (value === 'SENDING') return 'Gönderiliyor'
  if (value === 'SENT') return 'Gönderildi'
  if (value === 'FAILED') return 'Hata'
  return 'İptal'
}

export function numericTrendLabel(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '-'
}
