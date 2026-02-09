import { formatMinutesForHr } from '../utils/minutes'

export function MinuteDisplay({ minutes }: { minutes: number }) {
  return <span className="whitespace-nowrap">{formatMinutesForHr(minutes)}</span>
}
