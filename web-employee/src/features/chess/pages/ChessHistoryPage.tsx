import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getStoredDeviceFingerprint } from '../../../utils/device'
import { getChessHistory } from '../api/chessApi'
import { ChessStageLayout } from '../components/ChessStageLayout'
import type { ChessMatchSummary } from '../types'

export function ChessHistoryPage() {
  const navigate = useNavigate()
  const deviceFingerprint = getStoredDeviceFingerprint()
  const [items, setItems] = useState<ChessMatchSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceFingerprint) {
      return
    }
    void getChessHistory(deviceFingerprint)
      .then((response) => setItems(response.items))
      .catch((reason: Error) => setError(reason.message))
  }, [deviceFingerprint])

  return (
    <ChessStageLayout title="HISTORY" kicker="WAR TABLE / ARCHIVE">
      <section className="yabuchess-match-card">
        <p className="yabuchess-panel-kicker">MAC ARSIVI</p>
        <div className="yabuchess-room-listing">
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="yabuchess-room-row">
                <div>
                  <strong>{item.public_code}</strong>
                  <span>{item.result} / {item.match_type}</span>
                </div>
                <button type="button" className="yabuchess-screen-btn" onClick={() => navigate(`/yabuchess/match/${item.id}`)}>
                  ACIK
                </button>
              </div>
            ))
          ) : (
            <span className="yabuchess-empty-copy">Arsiv kaydi yok.</span>
          )}
          {error ? <span className="yabuchess-error-copy">{error}</span> : null}
        </div>
      </section>
    </ChessStageLayout>
  )
}
