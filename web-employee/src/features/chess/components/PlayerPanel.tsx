import type { ChessPlayerProjection, ChessSide } from '../types'
import { TimerDisplay } from './TimerDisplay'

export function PlayerPanel({
  player,
  clockMs,
  isActive,
  sideLabel,
}: {
  player?: ChessPlayerProjection | null
  clockMs: number
  isActive?: boolean
  sideLabel: ChessSide
}) {
  return (
    <div className={`yabuchess-player-panel yabuchess-player-panel--${sideLabel}`}>
      <div>
        <p>{sideLabel === 'w' ? 'TAC ORDUSU' : 'GOLGE LEJYONU'}</p>
        <h3>{player?.display_name ?? 'Bos Koltuk'}</h3>
        <span>{player?.rating ? `${player.rating} ELO` : player?.player_kind === 'AI' ? 'YABU ENGINE' : 'Hazir degil'}</span>
      </div>
      <TimerDisplay label="SURE" ms={clockMs} isActive={isActive} />
    </div>
  )
}

