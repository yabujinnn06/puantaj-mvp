import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getStoredDeviceFingerprint } from '../../../utils/device'
import { cancelChessMatchmaking, createChessMatch, enqueueChessMatchmaking, getChessLobby, joinChessMatch } from '../api/chessApi'
import { AIDifficultySelector } from '../components/AIDifficultySelector'
import { ChessStageLayout } from '../components/ChessStageLayout'
import { MatchmakingPanel } from '../components/MatchmakingPanel'
import type { ChessAIDifficulty, ChessLobbyResponse, ChessSide } from '../types'

export function ChessLobbyPage() {
  const navigate = useNavigate()
  const deviceFingerprint = getStoredDeviceFingerprint()
  const [lobby, setLobby] = useState<ChessLobbyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiDifficulty, setAiDifficulty] = useState<ChessAIDifficulty>('MEDIUM')
  const [preferredSide, setPreferredSide] = useState<ChessSide>('w')

  useEffect(() => {
    if (!deviceFingerprint) {
      setLoading(false)
      return
    }
    let cancelled = false
    void getChessLobby(deviceFingerprint)
      .then((data) => {
        if (!cancelled) {
          setLobby(data)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint])

  async function startAiMatch() {
    if (!deviceFingerprint) {
      return
    }
    try {
      const state = await createChessMatch({
        device_fingerprint: deviceFingerprint,
        match_type: 'AI',
        opponent_mode: 'AI',
        preferred_side: preferredSide,
        ai_difficulty: aiDifficulty,
      })
      navigate(`/yabuchess/match/${state.match.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI maçı açılamadı.')
    }
  }

  async function startOpenMatch() {
    if (!deviceFingerprint) {
      return
    }
    try {
      const state = await createChessMatch({
        device_fingerprint: deviceFingerprint,
        match_type: 'CASUAL',
        opponent_mode: 'HUMAN',
        preferred_side: preferredSide,
      })
      navigate(`/yabuchess/match/${state.match.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Oda açılamadı.')
    }
  }

  async function joinMatch(matchId: number) {
    if (!deviceFingerprint) {
      return
    }
    try {
      const state = await joinChessMatch(matchId, deviceFingerprint)
      navigate(`/yabuchess/match/${state.match.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maça girilemedi.')
    }
  }

  async function startQueue() {
    if (!deviceFingerprint) {
      return
    }
    try {
      const ack = await enqueueChessMatchmaking({
        device_fingerprint: deviceFingerprint,
        match_type: 'CASUAL',
        preferred_side: preferredSide,
      })
      if (ack.match_id) {
        navigate(`/yabuchess/match/${ack.match_id}`)
      } else if (deviceFingerprint) {
        const refreshed = await getChessLobby(deviceFingerprint)
        setLobby(refreshed)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Matchmaking başlatılamadı.')
    }
  }

  async function stopQueue() {
    if (!deviceFingerprint) {
      return
    }
    try {
      await cancelChessMatchmaking(deviceFingerprint)
      const refreshed = await getChessLobby(deviceFingerprint)
      setLobby(refreshed)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Matchmaking iptal edilemedi.')
    }
  }

  return (
    <ChessStageLayout title="YABU CHESS" kicker="WAR TABLE / LOBBY">
      <div className="yabuchess-hub-grid">
        <section className="yabuchess-match-card">
          <p className="yabuchess-panel-kicker">MAC BASLAT</p>
          <div className="yabuchess-inline-options">
            <button type="button" className={`yabuchess-inline-option ${preferredSide === 'w' ? 'is-active' : ''}`} onClick={() => setPreferredSide('w')}>
              BEYAZ
            </button>
            <button type="button" className={`yabuchess-inline-option ${preferredSide === 'b' ? 'is-active' : ''}`} onClick={() => setPreferredSide('b')}>
              SIYAH
            </button>
          </div>
          <AIDifficultySelector value={aiDifficulty} onChange={setAiDifficulty} />
          <div className="yabuchess-match-actions">
            <button type="button" className="yabuchess-screen-btn" onClick={() => void startAiMatch()}>
              AI MAC
            </button>
            <button type="button" className="yabuchess-screen-btn" onClick={() => void startOpenMatch()}>
              ODA AC
            </button>
          </div>
          {loading ? <span className="yabuchess-empty-copy">Lobi yukleniyor...</span> : null}
          {error ? <span className="yabuchess-error-copy">{error}</span> : null}
        </section>

        <section className="yabuchess-match-card">
          <p className="yabuchess-panel-kicker">ACIK MASALAR</p>
          <div className="yabuchess-room-listing">
            {lobby?.waiting_matches.length ? (
              lobby.waiting_matches.map((match) => (
                <div key={match.id} className="yabuchess-room-row">
                  <div>
                    <strong>{match.public_code}</strong>
                    <span>{match.white_player?.display_name ?? 'Beyaz'} vs {match.black_player?.display_name ?? 'Bekleniyor'}</span>
                  </div>
                  <button type="button" className="yabuchess-screen-btn" onClick={() => void joinMatch(match.id)}>
                    GIR
                  </button>
                </div>
              ))
            ) : (
              <span className="yabuchess-empty-copy">Bos masa yok. Yeni oda ac.</span>
            )}
          </div>
        </section>

        <MatchmakingPanel queueEntry={lobby?.queue_entry ?? null} onStart={() => void startQueue()} onCancel={() => void stopQueue()} />
      </div>
    </ChessStageLayout>
  )
}
