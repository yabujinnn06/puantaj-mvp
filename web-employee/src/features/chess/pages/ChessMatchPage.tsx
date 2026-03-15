import { useNavigate, useParams } from 'react-router-dom'

import { getStoredDeviceFingerprint } from '../../../utils/device'
import { createChessMatch } from '../api/chessApi'
import { BoardRenderer } from '../components/BoardRenderer'
import { ChessStageLayout } from '../components/ChessStageLayout'
import { MatchResultModal } from '../components/MatchResultModal'
import { MoveList } from '../components/MoveList'
import { PlayerPanel } from '../components/PlayerPanel'
import { useChessMatch } from '../hooks/useChessMatch'

export function ChessMatchPage() {
  const navigate = useNavigate()
  const params = useParams()
  const matchId = Number(params.matchId ?? 0)
  const deviceFingerprint = getStoredDeviceFingerprint()
  const { state, loading, error, sendMove, requestDraw, answerDraw, resign } = useChessMatch(
    Number.isFinite(matchId) && matchId > 0 ? matchId : null,
    deviceFingerprint,
  )

  const whitePlayer = state?.players.find((player) => player.side === 'w')
  const blackPlayer = state?.players.find((player) => player.side === 'b')
  const canRespondDraw = Boolean(state?.draw_offer_by_side && state.draw_offer_by_side !== state.you.side)

  async function handleReplay() {
    if (!deviceFingerprint) {
      return
    }
    const replay = await createChessMatch({
      device_fingerprint: deviceFingerprint,
      match_type: 'AI',
      opponent_mode: 'AI',
      preferred_side: state?.you.side ?? 'w',
      ai_difficulty: 'MEDIUM',
    })
    navigate(`/yabuchess/match/${replay.match.id}`)
  }

  return (
    <ChessStageLayout title="YABU CHESS" kicker="WAR TABLE / MATCH">
      {loading ? <section className="yabuchess-match-card"><span className="yabuchess-empty-copy">Mac yukleniyor...</span></section> : null}
      {error ? <section className="yabuchess-match-card"><span className="yabuchess-error-copy">{error}</span></section> : null}
      {state ? (
        <div className="yabuchess-match-layout">
          <div className="yabuchess-match-column">
            <PlayerPanel player={blackPlayer} clockMs={state.black_clock_ms} isActive={state.turn === 'b' && state.result === 'ONGOING'} sideLabel="b" />
            <BoardRenderer state={state} onMove={sendMove} />
            <PlayerPanel player={whitePlayer} clockMs={state.white_clock_ms} isActive={state.turn === 'w' && state.result === 'ONGOING'} sideLabel="w" />
            <div className="yabuchess-match-actions">
              <button type="button" className="yabuchess-screen-btn" onClick={() => void requestDraw()}>
                BERABERLIK
              </button>
              {canRespondDraw ? (
                <button type="button" className="yabuchess-screen-btn" onClick={() => void answerDraw(true)}>
                  KABUL
                </button>
              ) : null}
              <button type="button" className="yabuchess-screen-btn" onClick={() => void resign()}>
                TESLIM
              </button>
            </div>
          </div>

          <div className="yabuchess-match-column yabuchess-match-column--side">
            <MoveList moves={state.moves} />
            <section className="yabuchess-match-card">
              <p className="yabuchess-panel-kicker">MATCH DATA</p>
              <div className="yabuchess-queue-state">
                <strong>{state.match.public_code}</strong>
                <span>{state.match.match_type} / {state.match.status}</span>
                <span>{state.pgn || 'PGN hazirlaniyor.'}</span>
              </div>
            </section>
          </div>

          <MatchResultModal state={state} onReplay={() => void handleReplay()} onExit={() => navigate('/yabuchess')} />
        </div>
      ) : null}
    </ChessStageLayout>
  )
}
