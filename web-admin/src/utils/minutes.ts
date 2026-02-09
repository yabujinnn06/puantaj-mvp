function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

export function toHourMinuteParts(totalMinutes: number): { hours: number; minutes: number } {
  const safeMinutes = clampMinutes(totalMinutes)
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return { hours, minutes }
}

export function formatMinutesAsClock(totalMinutes: number): string {
  const { hours, minutes } = toHourMinuteParts(totalMinutes)
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatMinutesAsHuman(totalMinutes: number): string {
  const { hours, minutes } = toHourMinuteParts(totalMinutes)
  if (hours === 0) {
    return `${minutes}dk`
  }
  return `${hours}s ${minutes}dk`
}

export function formatMinutesForHr(totalMinutes: number): string {
  return `${formatMinutesAsClock(totalMinutes)} (${formatMinutesAsHuman(totalMinutes)})`
}
