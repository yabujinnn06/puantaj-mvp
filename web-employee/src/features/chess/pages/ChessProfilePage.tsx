import { useEffect, useState } from 'react'

import { getStoredDeviceFingerprint } from '../../../utils/device'
import { getChessProfile } from '../api/chessApi'
import { ChessStageLayout } from '../components/ChessStageLayout'
import type { ChessProfile } from '../types'

export function ChessProfilePage() {
  const deviceFingerprint = getStoredDeviceFingerprint()
  const [profile, setProfile] = useState<ChessProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceFingerprint) {
      return
    }
    void getChessProfile(deviceFingerprint)
      .then(setProfile)
      .catch((reason: Error) => setError(reason.message))
  }, [deviceFingerprint])

  return (
    <ChessStageLayout title="PROFILE" kicker="WAR TABLE / PLAYER">
      <div className="yabuchess-hub-grid">
        <section className="yabuchess-match-card">
          <p className="yabuchess-panel-kicker">RATING</p>
          <h3>{profile?.display_name ?? 'Yukleniyor'}</h3>
          <div className="yabuchess-profile-stats">
            <span>ELO {profile?.rating.current_rating ?? 0}</span>
            <span>PEAK {profile?.rating.peak_rating ?? 0}</span>
            <span>STREAK {profile?.rating.streak ?? 0}</span>
            <span>MAC {profile?.rating.total_games ?? 0}</span>
          </div>
          {error ? <span className="yabuchess-error-copy">{error}</span> : null}
        </section>
        <section className="yabuchess-match-card">
          <p className="yabuchess-panel-kicker">SON MATCHLER</p>
          <div className="yabuchess-room-listing">
            {profile?.recent_matches.map((match) => (
              <div key={match.id} className="yabuchess-room-row">
                <div>
                  <strong>{match.public_code}</strong>
                  <span>{match.result}</span>
                </div>
              </div>
            )) ?? <span className="yabuchess-empty-copy">Mac kaydi yok.</span>}
          </div>
        </section>
      </div>
    </ChessStageLayout>
  )
}

