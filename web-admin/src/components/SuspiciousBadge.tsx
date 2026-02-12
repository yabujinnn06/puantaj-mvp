export function SuspiciousBadge({
  suspicious,
  label = 'Supheli',
  tooltip,
}: {
  suspicious: boolean
  label?: string
  tooltip?: string
}) {
  if (!suspicious) {
    return <span className="status-badge status-badge-neutral">Normal</span>
  }

  return (
    <span className="status-badge status-badge-incomplete" title={tooltip}>
      {label}
    </span>
  )
}

