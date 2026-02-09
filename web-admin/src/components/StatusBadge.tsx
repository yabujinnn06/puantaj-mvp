export function StatusBadge({ value }: { value: string }) {
  const key = value.toUpperCase()

  if (key === 'OK' || key === 'AKTIF' || key === 'APPROVED') {
    return <span className="status-badge status-badge-ok">{value}</span>
  }
  if (key === 'INCOMPLETE') {
    return <span className="status-badge status-badge-incomplete">INCOMPLETE</span>
  }
  if (key === 'LEAVE') {
    return <span className="status-badge status-badge-leave">LEAVE</span>
  }
  if (key === 'OFF') {
    return <span className="status-badge status-badge-neutral">OFF</span>
  }
  if (key === 'PENDING') {
    return <span className="status-badge status-badge-pending">PENDING</span>
  }
  if (key === 'REJECTED' || key === 'PASIF') {
    return <span className="status-badge status-badge-danger">{value}</span>
  }

  return <span className="status-badge status-badge-neutral">{value}</span>
}
