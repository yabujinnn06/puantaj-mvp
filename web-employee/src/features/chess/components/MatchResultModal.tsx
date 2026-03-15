import type { ChessMatchState } from '../types'

function getResultCopy(state: ChessMatchState): string {
  if (state.result === 'WHITE_WIN') {
    return 'Tac Ordusu kazandi.'
  }
  if (state.result === 'BLACK_WIN') {
    return 'Golge Lejyonu kazandi.'
  }
  if (state.result === 'DRAW') {
    return 'Savas berabere bitti.'
  }
  return ''
}

export function MatchResultModal({
  state,
  onReplay,
  onExit,
}: {
  state: ChessMatchState
  onReplay: () => void
  onExit: () => void
}) {
  if (state.result === 'ONGOING') {
    return null
  }
  return (
    <div className="yabuchess-match-card yabuchess-result-modal">
      <p>MAC BITTI</p>
      <h2>{getResultCopy(state)}</h2>
      <span className="yabuchess-result-reason">{state.ended_reason ?? 'Sonuc kaydi alindi.'}</span>
      <div className="yabuchess-match-actions">
        <button type="button" className="yabuchess-screen-btn" onClick={onReplay}>
          YENI MAC
        </button>
        <button type="button" className="yabuchess-screen-btn" onClick={onExit}>
          LOBI
        </button>
      </div>
    </div>
  )
}
