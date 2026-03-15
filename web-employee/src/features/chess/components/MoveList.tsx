import type { ChessMove } from '../types'

export function MoveList({ moves }: { moves: ChessMove[] }) {
  return (
    <div className="yabuchess-match-card">
      <p className="yabuchess-panel-kicker">HAMLELER</p>
      <div className="yabuchess-move-list">
        {moves.length === 0 ? (
          <span className="yabuchess-empty-copy">Ilk hamle bekleniyor.</span>
        ) : (
          moves.map((move) => (
            <div key={move.id} className="yabuchess-move-row">
              <strong>{move.ply_number}.</strong>
              <span>{move.san}</span>
              <small>{move.played_by_name ?? 'Bilinmiyor'}</small>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

