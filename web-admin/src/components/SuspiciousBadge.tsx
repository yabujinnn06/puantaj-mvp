export function SuspiciousBadge({
  suspicious,
  label = 'Şüpheli',
}: {
  suspicious: boolean
  label?: string
}) {
  if (!suspicious) {
    return <span className="status-badge status-badge-neutral">Normal</span>
  }

  return (
    <span className="status-badge status-badge-incomplete">
      {label}
    </span>
  )
}
