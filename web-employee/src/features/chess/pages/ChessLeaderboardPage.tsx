import { useEffect, useState } from 'react'

import { getChessLeaderboard } from '../api/chessApi'
import { ChessStageLayout } from '../components/ChessStageLayout'
import type { ChessLeaderboardEntry } from '../types'

export function ChessLeaderboardPage() {
  const [items, setItems] = useState<ChessLeaderboardEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getChessLeaderboard()
      .then((response) => setItems(response.items))
      .catch((reason: Error) => setError(reason.message))
  }, [])

  return (
    <ChessStageLayout title="LEADERBOARD" kicker="WAR TABLE / RANKING">
      <section className="yabuchess-match-card">
        <p className="yabuchess-panel-kicker">USTA OYUNCULAR</p>
        <div className="yabuchess-room-listing">
          {items.map((item) => (
            <div key={item.employee_id} className="yabuchess-room-row">
              <div>
                <strong>#{item.rank} {item.display_name}</strong>
                <span>{item.current_rating} ELO / {item.total_games} MAC</span>
              </div>
            </div>
          ))}
          {error ? <span className="yabuchess-error-copy">{error}</span> : null}
        </div>
      </section>
    </ChessStageLayout>
  )
}

