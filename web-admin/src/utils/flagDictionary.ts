export interface FlagMeta {
  label: string
  description: string
  tone?: 'neutral' | 'warning' | 'danger' | 'info'
}

const FLAG_DICTIONARY: Record<string, FlagMeta> = {
  DUPLICATE_EVENT: {
    label: 'Mükerrer kayıt',
    description: 'Aynı gün içinde aynı tipte (IN/OUT) birden fazla kayıt tespit edildi.',
    tone: 'warning',
  },
  MANUAL_CHECKOUT: {
    label: 'Manuel çıkış',
    description: 'Çıkış kaydı çalışan tarafından manuel butonla oluşturuldu.',
    tone: 'info',
  },
  NEEDS_SHIFT_REVIEW: {
    label: 'Vardiya kontrolü gerekli',
    description: 'Otomatik atanan vardiya ile giriş saati arasında yüksek fark var. İK kontrol etmelidir.',
    tone: 'warning',
  },
  SHIFT_WEEKLY_RULE_OVERRIDE: {
    label: 'Vardiya-kural çakışması',
    description:
      'Aynı gün için haftalık gün kuralı ile vardiya süresi/mola bilgisi farklı. Hesaplamada vardiya kuralı önceliklendirildi.',
    tone: 'warning',
  },
  RULE_SOURCE_MANUAL_OVERRIDE: {
    label: 'Kural manuel seçildi',
    description: 'Bu gün için kural kaynağı İK tarafından manuel olarak seçildi.',
    tone: 'info',
  },
  RULE_OVERRIDE_INVALID: {
    label: 'Geçersiz manuel kural',
    description: 'Manuel seçilen kural kaynağı o gün için uygulanamadı; sistem otomatik kurala döndü.',
    tone: 'warning',
  },
  UNDERWORKED: {
    label: 'Eksik çalışma',
    description: 'Net çalışma süresi, o gün için planlanan sürenin altında kaldı.',
    tone: 'warning',
  },
  LOCATION_NO_LOCATION: {
    label: 'Konum yok',
    description: 'Kayıt sırasında konum bilgisi gönderilmedi veya alınamadı.',
    tone: 'warning',
  },
  LOCATION_UNVERIFIED: {
    label: 'Ev dışı konum',
    description: 'Kayıt, tanımlı ev konumu yarıçapı dışında alındı.',
    tone: 'warning',
  },
  ADMIN_MANUAL_EVENT: {
    label: 'Admin manuel kayıt',
    description: 'Kayıt admin tarafından manuel olarak eklenmiş/düzenlenmiş.',
    tone: 'info',
  },
  EKSIK_GUN: {
    label: 'Eksik gün',
    description: 'Gün içinde giriş veya çıkış kaydı eksik olduğu için gün tamamlanmamış görünüyor.',
    tone: 'danger',
  },
  MISSING_IN: {
    label: 'Giriş eksik',
    description: 'Bu gün için giriş (IN) kaydı bulunamadı.',
    tone: 'danger',
  },
  MISSING_OUT: {
    label: 'Çıkış eksik',
    description: 'Bu gün için çıkış (OUT) kaydı bulunamadı.',
    tone: 'danger',
  },
  DAILY_MAX_EXCEEDED: {
    label: 'Günlük süre aşıldı',
    description: 'Günlük azami çalışma süresi (11 saat) aşıldı.',
    tone: 'danger',
  },
  MIN_BREAK_NOT_MET: {
    label: 'Yasal mola yetersiz',
    description: 'Tanımlı mola, yasal minimum mola süresinin altında kaldı.',
    tone: 'warning',
  },
  NIGHT_WORK_EXCEEDED: {
    label: 'Gece çalışma sınırı aşıldı',
    description: 'Gece çalışma süresi yasal sınırın üzerinde görünüyor.',
    tone: 'danger',
  },
  ANNUAL_OVERTIME_CAP_EXCEEDED: {
    label: 'Yıllık fazla mesai limiti aşıldı',
    description: 'Çalışanın yıllık fazla mesai limiti aşıldı.',
    tone: 'danger',
  },
}

export function getFlagMeta(code: string): FlagMeta {
  return (
    FLAG_DICTIONARY[code] ?? {
      label: code,
      description: `${code} bayrağı için açıklama tanımlı değil.`,
      tone: 'neutral',
    }
  )
}

export function knownComplianceFlags(): string[] {
  return [
    'DAILY_MAX_EXCEEDED',
    'MIN_BREAK_NOT_MET',
    'NIGHT_WORK_EXCEEDED',
    'ANNUAL_OVERTIME_CAP_EXCEEDED',
    'SHIFT_WEEKLY_RULE_OVERRIDE',
    'UNDERWORKED',
  ]
}
