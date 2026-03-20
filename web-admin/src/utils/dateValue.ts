const ADMIN_TIMEZONE = 'Europe/Istanbul'

export function dateValue(offsetDays = 0): string {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ADMIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}
