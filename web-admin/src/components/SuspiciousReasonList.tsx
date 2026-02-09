import { getFlagMeta } from '../utils/flagDictionary'

function badgeClassForTone(tone: 'neutral' | 'warning' | 'danger' | 'info' | undefined): string {
  if (tone === 'danger') {
    return 'status-badge status-badge-incomplete'
  }
  if (tone === 'warning') {
    return 'status-badge status-badge-incomplete'
  }
  if (tone === 'info') {
    return 'status-badge status-badge-leave'
  }
  return 'status-badge status-badge-neutral'
}

export function SuspiciousReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return <span className="status-badge status-badge-neutral">Sorun yok</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span
          key={reason}
          title={getFlagMeta(reason).description}
          className={badgeClassForTone(getFlagMeta(reason).tone)}
        >
          {getFlagMeta(reason).label}
        </span>
      ))}
    </div>
  )
}
