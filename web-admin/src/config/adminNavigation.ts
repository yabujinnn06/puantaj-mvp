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
  | 'admin_users'

export const adminPermissionModules: Array<{ key: AdminPermissionKey; label: string }> = [
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
  { key: 'admin_users', label: 'Admin Kullanicilari' },
]

export const adminNavItems: Array<{ to: string; label: string; permission?: AdminPermissionKey }> = [
  { to: '/management-console', label: 'Ana Panel', permission: 'employees' },
  { to: '/log', label: 'Log', permission: 'log' },
  { to: '/regions', label: 'Bolgeler', permission: 'regions' },
  { to: '/departments', label: 'Departmanlar', permission: 'departments' },
  { to: '/employees', label: 'Calisanlar', permission: 'employees' },
  { to: '/quick-setup', label: 'Hizli Ayarlar', permission: 'schedule' },
  { to: '/work-rules', label: 'Mesai Kurallari', permission: 'work_rules' },
  { to: '/attendance-events', label: 'Yoklama Kayitlari', permission: 'attendance_events' },
  { to: '/devices', label: 'Cihazlar', permission: 'devices' },
  { to: '/compliance-settings', label: 'Uyumluluk Ayarlari', permission: 'compliance' },
  { to: '/qr-kodlar', label: 'QR Kodlar', permission: 'qr_codes' },
  { to: '/leaves', label: 'Izinler', permission: 'leaves' },
  { to: '/reports/employee-monthly', label: 'Aylik Calisan Raporu', permission: 'reports' },
  { to: '/reports/department-summary', label: 'Departman Ozeti', permission: 'reports' },
  { to: '/reports/excel-export', label: 'Excel Disa Aktar', permission: 'reports' },
  { to: '/notifications', label: 'Bildirimler', permission: 'notifications' },
  { to: '/audit-logs', label: 'Sistem Loglari', permission: 'audit_logs' },
  { to: '/admin-users', label: 'Admin Kullanicilari', permission: 'admin_users' },
]

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
  const firstVisibleItem = adminNavItems.find((item) => !item.permission || hasPermission(item.permission))
  return firstVisibleItem?.to ?? null
}
