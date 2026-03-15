export function TimerDisplay({ label, ms, isActive }: { label: string; ms: number; isActive?: boolean }) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return (
    <div className={`yabuchess-timer ${isActive ? 'is-active' : ''}`}>
      <span>{label}</span>
      <strong>
        {minutes}:{String(seconds).padStart(2, '0')}
      </strong>
    </div>
  )
}

