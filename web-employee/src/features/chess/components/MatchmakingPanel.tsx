import type { ChessQueueEntry } from '../types'

export function MatchmakingPanel({
  queueEntry,
  onStart,
  onCancel,
}: {
  queueEntry?: ChessQueueEntry | null
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <div className="yabuchess-match-card">
      <p className="yabuchess-panel-kicker">MATCHMAKING</p>
      {queueEntry ? (
        <div className="yabuchess-queue-state">
          <strong>{queueEntry.match_type}</strong>
          <span>Queue aktif. Eslesen rakip bekleniyor.</span>
          <button type="button" className="yabuchess-screen-btn" onClick={onCancel}>
            IPTAL
          </button>
        </div>
      ) : (
        <div className="yabuchess-queue-state">
          <span>Canli rakip aramak icin queue ac.</span>
          <button type="button" className="yabuchess-screen-btn" onClick={onStart}>
            MATCHMAKING BASLAT
          </button>
        </div>
      )}
    </div>
  )
}
