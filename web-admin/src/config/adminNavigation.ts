export type AdminPermissionKey =
  | 'log'
  | 'regions'
  | 'departments'
  | 'employees'
  | 'devices'
  | 'work_rules'
  | 'attendance_events'
  | 'leaves'
  | 'reports'
  | 'compliance'
  | 'schedule'
  | 'qr_codes'
  | 'notifications'
  | 'audit_logs'
  | 'manual_overrides'
  | 'audit'
  | 'admin_users'

export type AdminNavSectionKey =
  | 'overview'
  | 'organization'
  | 'attendance'
  | 'reporting'
  | 'administration'

export type AdminNavItem = {
  to: string
  label: string
  permission?: AdminPermissionKey
  section: AdminNavSectionKey
  aliases?: string[]
}

export type AdminNavSection = {
  key: AdminNavSectionKey
  label: string
  items: AdminNavItem[]
}

export const adminPermissionModules: Array<{
  key: AdminPermissionKey
  label: string
}> = [
  { key: 'log', label: 'Log' },
  { key: 'regions', label: 'Bolgeler' },
  { key: 'departments', label: 'Departmanlar' },
  { key: 'employees', label: 'Calisanlar' },
  { key: 'devices', label: 'Cihazlar' },
  { key: 'work_rules', label: 'Mesai Kurallari' },
  { key: 'attendance_events', label: 'Yoklama Kayitlari' },
  { key: 'leaves', label: 'Izinler' },
  { key: 'reports', label: 'Raporlar' },
  { key: 'compliance', label: 'Uyumluluk' },
  { key: 'schedule', label: 'Planlama' },
  { key: 'qr_codes', label: 'QR Kodlar' },
  { key: 'notifications', label: 'Bildirimler' },
  { key: 'audit_logs', label: 'Sistem Loglari' },
  { key: 'manual_overrides', label: 'Manuel Duzeltme' },
  { key: 'audit', label: 'Denetim' },
  { key: 'admin_users', label: 'Admin Kullanicilari' },
]

export const adminNavItems: AdminNavItem[] = [
  {
    to: '/management-console',
    label: 'Ana Panel',
    permission: 'employees',
    section: 'overview',
    aliases: ['/control-room', '/dashboard'],
  },
  {
    to: '/log',
    label: 'Log',
    permission: 'log',
    section: 'overview',
    aliases: ['/location-monitor'],
  },
  {
    to: '/regions',
    label: 'Bolgeler',
    permission: 'regions',
    section: 'organization',
  },
  {
    to: '/departments',
    label: 'Departmanlar',
    permission: 'departments',
    section: 'organization',
  },
  {
    to: '/employees',
    label: 'Calisanlar',
    permission: 'employees',
    section: 'organization',
  },
  {
    to: '/quick-setup',
    label: 'Hizli Ayarlar',
    permission: 'schedule',
    section: 'attendance',
  },
  {
    to: '/work-rules',
    label: 'Mesai Kurallari',
    permission: 'work_rules',
    section: 'attendance',
  },
  {
    to: '/attendance-events',
    label: 'Yoklama Kayitlari',
    permission: 'attendance_events',
    section: 'attendance',
  },
  {
    to: '/devices',
    label: 'Cihazlar',
    permission: 'devices',
    section: 'attendance',
  },
  {
    to: '/compliance-settings',
    label: 'Uyumluluk Ayarlari',
    permission: 'compliance',
    section: 'reporting',
  },
  {
    to: '/qr-kodlar',
    label: 'QR Kodlar',
    permission: 'qr_codes',
    section: 'attendance',
  },
  {
    to: '/leaves',
    label: 'Izinler',
    permission: 'leaves',
    section: 'attendance',
  },
  {
    to: '/reports/employee-monthly',
    label: 'Aylik Calisan Raporu',
    permission: 'reports',
    section: 'reporting',
  },
  {
    to: '/reports/department-summary',
    label: 'Departman Ozeti',
    permission: 'reports',
    section: 'reporting',
  },
  {
    to: '/reports/excel-export',
    label: 'Excel Disa Aktar',
    permission: 'reports',
    section: 'reporting',
  },
  {
    to: '/notifications',
    label: 'Bildirimler',
    permission: 'notifications',
    section: 'administration',
  },
  {
    to: '/audit-logs',
    label: 'Sistem Loglari',
    permission: 'audit_logs',
    section: 'administration',
  },
  {
    to: '/admin-users',
    label: 'Admin Kullanicilari',
    permission: 'admin_users',
    section: 'administration',
  },
]

const adminNavSectionLabels: Array<{ key: AdminNavSectionKey; label: string }> =
  [
    { key: 'overview', label: 'Genel Bakis' },
    { key: 'organization', label: 'Organizasyon' },
    { key: 'attendance', label: 'Saha ve Yoklama' },
    { key: 'reporting', label: 'Raporlama ve Uyumluluk' },
    { key: 'administration', label: 'Sistem ve Yonetim' },
  ]

export const adminNavSections: AdminNavSection[] = adminNavSectionLabels.map(
  (section) => ({
    ...section,
    items: adminNavItems.filter((item) => item.section === section.key),
  }),
)

export const adminPageTitles: Record<string, string> = {
  '/management-console': 'Ana Panel',
  '/log': 'Log',
  '/location-monitor': 'Log',
  '/control-room': 'Ana Panel',
  '/dashboard': 'Ana Panel',
  '/regions': 'Bolgeler',
  '/departments': 'Departmanlar',
  '/employees': 'Calisanlar',
  '/quick-setup': 'Hizli Ayarlar',
  '/work-rules': 'Mesai Kurallari',
  '/attendance-events': 'Yoklama Kayitlari',
  '/devices': 'Cihazlar',
  '/compliance-settings': 'Uyumluluk Ayarlari',
  '/qr-kodlar': 'QR Kodlar',
  '/leaves': 'Izinler',
  '/reports/employee-monthly': 'Aylik Calisan Raporu',
  '/reports/department-summary': 'Departman Ozeti',
  '/reports/excel-export': 'Excel Disa Aktar',
  '/notifications': 'Bildirimler',
  '/audit-logs': 'Sistem Loglari',
  '/admin-users': 'Admin Kullanicilari',
}

export function getFirstAccessibleAdminPath(
  hasPermission: (permission: string, mode?: 'read' | 'write') => boolean,
): string | null {
  const firstVisibleItem = adminNavItems.find(
    (item) => !item.permission || hasPermission(item.permission),
  )
  return firstVisibleItem?.to ?? null
}
