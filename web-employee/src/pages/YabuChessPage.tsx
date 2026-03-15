import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js'

type PieceColor = Color
type PieceKind = PieceSymbol
type BoardSquare = Square

interface PieceState {
  type: PieceKind
  color: PieceColor
}

type GameMove = Move

interface CaptureCinematic {
  id: string
  san: string
  attackerType: PieceKind
  attackerColor: PieceColor
  defenderType: PieceKind
  defenderColor: PieceColor
}

interface PromotionDraft {
  from: BoardSquare
  to: BoardSquare
  color: PieceColor
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const
const PROMOTION_CHOICES: PieceKind[] = ['q', 'r', 'b', 'n']

const PIECE_SIGILS: Record<PieceKind, string> = {
  p: 'P',
  n: 'N',
  b: 'B',
  r: 'R',
  q: 'Q',
  k: 'K',
}

const PIECE_NAMES: Record<PieceKind, string> = {
  p: 'Piyon',
  n: 'At',
  b: 'Fil',
  r: 'Kale',
  q: 'Vezir',
  k: 'Sah',
}

const FACTION_NAMES: Record<PieceColor, string> = {
  w: 'Tac Ordusu',
  b: 'Golge Lejyonu',
}

const CAPTURE_TITLES: Record<PieceKind, string> = {
  p: 'Piyon Baskini',
  n: 'At Hucumu',
  b: 'Fil Laneti',
  r: 'Kale Darbesi',
  q: 'Vezir Firtinasi',
  k: 'Sah Hukumru',
}

function getSquareColor(square: BoardSquare): 'light' | 'dark' {
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number])
  const rankIndex = RANKS.indexOf(square[1] as (typeof RANKS)[number])
  return (fileIndex + rankIndex) % 2 === 0 ? 'light' : 'dark'
}

function getPiece(square: BoardSquare, game: Chess): PieceState | null {
  const piece = game.get(square)
  if (!piece) {
    return null
  }
  return { type: piece.type as PieceKind, color: piece.color as PieceColor }
}

function createCaptureCinematic(move: GameMove): CaptureCinematic | null {
  if (!move.captured) {
    return null
  }
  return {
    id: `${move.from}-${move.to}-${move.san}-${Date.now()}`,
    san: move.san,
    attackerType: move.piece,
    attackerColor: move.color,
    defenderType: move.captured,
    defenderColor: move.color === 'w' ? 'b' : 'w',
  }
}

function getStatusText(game: Chess): string {
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Golge Lejyonu' : 'Tac Ordusu'
    return `MAT. ${winner} savasi kazandi.`
  }
  if (game.isDraw()) {
    return 'Savasta denge kuruldu.'
  }
  const currentFaction = FACTION_NAMES[game.turn() as PieceColor]
  if (game.isCheck()) {
    return `${currentFaction} sah cekildi.`
  }
  return `Sira ${currentFaction}.`
}

function YabuChessPiece({
  piece,
  isSelected,
  isTargeted,
  isMoved,
  cinematicRole,
}: {
  piece: PieceState
  isSelected?: boolean
  isTargeted?: boolean
  isMoved?: boolean
  cinematicRole?: 'attacker' | 'defender'
}) {
  return (
    <span
      className={[
        'yabuchess-piece',
        `yabuchess-piece--side-${piece.color}`,
        `yabuchess-piece--type-${piece.type}`,
        isSelected ? 'is-selected' : '',
        isTargeted ? 'is-targeted' : '',
        isMoved ? 'is-moved' : '',
        cinematicRole ? `is-${cinematicRole}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className="yabuchess-piece-aura" />
      <span className="yabuchess-piece-shell">
        <span className="yabuchess-piece-glyph">{PIECE_SIGILS[piece.type]}</span>
      </span>
    </span>
  )
}

export function YabuChessPage() {
  const navigate = useNavigate()
  const gameRef = useRef(new Chess())
  const [positionFen, setPositionFen] = useState(() => gameRef.current.fen())
  const [selectedSquare, setSelectedSquare] = useState<BoardSquare | null>(null)
  const [legalMoves, setLegalMoves] = useState<GameMove[]>([])
  const [captureCinematic, setCaptureCinematic] = useState<CaptureCinematic | null>(null)
  const [promotionDraft, setPromotionDraft] = useState<PromotionDraft | null>(null)
  const [cinematicEnabled, setCinematicEnabled] = useState(true)
  const [lastMove, setLastMove] = useState<{ from: BoardSquare; to: BoardSquare } | null>(null)

  const game = gameRef.current
  const history = useMemo(() => game.history({ verbose: true }) as GameMove[], [positionFen, game])
  const statusText = useMemo(() => getStatusText(game), [positionFen, game])
  const moveCount = history.length
  const latestMove = history.at(-1) ?? null
  const fallenLight = useMemo(
    () =>
      history
        .filter((move) => move.captured && move.color === 'b')
        .map((move, index) => ({ id: `light-${index}-${move.san}`, type: move.captured as PieceKind })),
    [history],
  )
  const fallenDark = useMemo(
    () =>
      history
        .filter((move) => move.captured && move.color === 'w')
        .map((move, index) => ({ id: `dark-${index}-${move.san}`, type: move.captured as PieceKind })),
    [history],
  )

  useEffect(() => {
    if (!captureCinematic) {
      return undefined
    }
    const timerId = window.setTimeout(() => {
      setCaptureCinematic(null)
    }, 1250)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [captureCinematic])

  function refreshPosition(nextMove?: GameMove | null): void {
    setPositionFen(game.fen())
    setSelectedSquare(null)
    setLegalMoves([])
    if (nextMove) {
      setLastMove({ from: nextMove.from, to: nextMove.to })
      if (cinematicEnabled) {
        setCaptureCinematic(createCaptureCinematic(nextMove))
      }
    }
  }

  function beginSelection(square: BoardSquare): void {
    const piece = getPiece(square, game)
    if (!piece || piece.color !== (game.turn() as PieceColor)) {
      setSelectedSquare(null)
      setLegalMoves([])
      return
    }
    const nextMoves = game.moves({ square, verbose: true }) as GameMove[]
    setSelectedSquare(square)
    setLegalMoves(nextMoves)
  }

  function commitMove(from: BoardSquare, to: BoardSquare, promotion?: PieceKind): void {
    const move = game.move({ from, to, promotion }) as GameMove | null
    if (!move) {
      return
    }
    refreshPosition(move)
  }

  function handleSquarePress(square: BoardSquare): void {
    if (promotionDraft) {
      return
    }

    if (selectedSquare) {
      const plannedMove = legalMoves.find((move) => move.to === square)
      if (plannedMove) {
        const movingPiece = getPiece(plannedMove.from, game)
        const isPromotion =
          movingPiece?.type === 'p' &&
          ((movingPiece.color === 'w' && square.endsWith('8')) || (movingPiece.color === 'b' && square.endsWith('1')))
        if (movingPiece && isPromotion) {
          setPromotionDraft({ from: plannedMove.from, to: square, color: movingPiece.color })
          return
        }
        commitMove(plannedMove.from, square)
        return
      }
    }

    beginSelection(square)
  }

  function handlePromotionChoice(pieceType: PieceKind): void {
    if (!promotionDraft) {
      return
    }
    commitMove(promotionDraft.from, promotionDraft.to, pieceType)
    setPromotionDraft(null)
  }

  function resetBattle(): void {
    game.reset()
    setPromotionDraft(null)
    setCaptureCinematic(null)
    setLastMove(null)
    setSelectedSquare(null)
    setLegalMoves([])
    setPositionFen(game.fen())
  }

  function undoMove(): void {
    const undone = game.undo()
    if (!undone) {
      return
    }
    setPromotionDraft(null)
    setCaptureCinematic(null)
    setSelectedSquare(null)
    setLegalMoves([])
    const previousMove = (game.history({ verbose: true }) as GameMove[]).at(-1) ?? null
    setLastMove(previousMove ? { from: previousMove.from, to: previousMove.to } : null)
    setPositionFen(game.fen())
  }

  return (
    <main className="yabuchess-page">
      <section className="yabuchess-shell">
        <div className="yabuchess-sky" aria-hidden="true">
          <span className="yabuchess-moon" />
          <span className="yabuchess-tower yabuchess-tower--left" />
          <span className="yabuchess-tower yabuchess-tower--right" />
          <span className="yabuchess-mist yabuchess-mist--one" />
          <span className="yabuchess-mist yabuchess-mist--two" />
          <span className="yabuchess-embers" />
        </div>

        <header className="yabuchess-header">
          <div className="yabuchess-header-copy">
            <p className="yabuchess-kicker">YABU CLUB / WAR TABLE</p>
            <h1>YABU CHESS</h1>
            <p className="yabuchess-subtitle">
              Siyah beyaz tahtada, kul tepelerinin arasinda kurulan savas masasi.
            </p>
          </div>
          <div className="yabuchess-header-actions">
            <button type="button" className="yabuchess-chip-btn" onClick={undoMove}>
              GERI AL
            </button>
            <button type="button" className="yabuchess-chip-btn" onClick={resetBattle}>
              YENI SAVAS
            </button>
            <button type="button" className="yabuchess-chip-btn" onClick={() => navigate('/')}>
              CIK
            </button>
          </div>
        </header>

        <section className="yabuchess-war-room">
          <div className="yabuchess-stage">
            <div className="yabuchess-stage-bar">
              <span>{statusText}</span>
              <span>{latestMove ? `Son hamle ${latestMove.san}` : 'Savasa hazir'}</span>
              <span>{`Hamle ${Math.max(1, Math.ceil(moveCount / 2))}`}</span>
            </div>

            <div className="yabuchess-board-wrap">
              <div className="yabuchess-board-legend yabuchess-board-legend--top">
                {FILES.map((file) => (
                  <span key={`top-${file}`}>{file.toUpperCase()}</span>
                ))}
              </div>

              <div className="yabuchess-board-frame">
                <div className="yabuchess-board">
                  {RANKS.flatMap((rank) =>
                    FILES.map((file) => {
                      const square = `${file}${rank}` as BoardSquare
                      const piece = getPiece(square, game)
                      const isSelected = selectedSquare === square
                      const matchingMove = legalMoves.find((move) => move.to === square)
                      const isLegalTarget = Boolean(matchingMove)
                      const isCaptureTarget = Boolean(matchingMove?.captured)
                      const isLastMove = lastMove?.from === square || lastMove?.to === square

                      return (
                        <button
                          key={square}
                          type="button"
                          className={[
                            'yabuchess-square',
                            `yabuchess-square--${getSquareColor(square)}`,
                            isSelected ? 'is-selected' : '',
                            isLegalTarget ? 'is-legal' : '',
                            isCaptureTarget ? 'is-capture' : '',
                            isLastMove ? 'is-last-move' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => handleSquarePress(square)}
                        >
                          <span className="yabuchess-square-coord">{square}</span>
                          {isLegalTarget ? (
                            <span
                              className={[
                                'yabuchess-square-marker',
                                isCaptureTarget ? 'is-capture' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            />
                          ) : null}
                          {piece ? (
                            <YabuChessPiece
                              piece={piece}
                              isSelected={isSelected}
                              isTargeted={isCaptureTarget}
                              isMoved={lastMove?.to === square}
                            />
                          ) : null}
                        </button>
                      )
                    }),
                  )}
                </div>
              </div>

              <div className="yabuchess-board-legend yabuchess-board-legend--bottom">
                {FILES.map((file) => (
                  <span key={`bottom-${file}`}>{file.toUpperCase()}</span>
                ))}
              </div>
            </div>

            {captureCinematic ? (
              <div className="yabuchess-cinematic" aria-live="polite">
                <div className="yabuchess-cinematic-copy">
                  <p className="yabuchess-kicker">{CAPTURE_TITLES[captureCinematic.attackerType]}</p>
                  <h2>{captureCinematic.san}</h2>
                </div>
                <div className="yabuchess-cinematic-fighters">
                  <YabuChessPiece
                    piece={{
                      type: captureCinematic.attackerType,
                      color: captureCinematic.attackerColor,
                    }}
                    cinematicRole="attacker"
                  />
                  <span className="yabuchess-cinematic-slash" aria-hidden="true" />
                  <YabuChessPiece
                    piece={{
                      type: captureCinematic.defenderType,
                      color: captureCinematic.defenderColor,
                    }}
                    cinematicRole="defender"
                  />
                </div>
              </div>
            ) : null}

            {promotionDraft ? (
              <div className="yabuchess-promotion">
                <p className="yabuchess-kicker">YUKSELME</p>
                <h2>Piyon neye donussun?</h2>
                <div className="yabuchess-promotion-row">
                  {PROMOTION_CHOICES.map((pieceType) => (
                    <button
                      key={pieceType}
                      type="button"
                      className="yabuchess-promotion-btn"
                      onClick={() => handlePromotionChoice(pieceType)}
                    >
                      <YabuChessPiece piece={{ type: pieceType, color: promotionDraft.color }} />
                      <span>{PIECE_NAMES[pieceType]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="yabuchess-sidebar">
            <section className="yabuchess-card">
              <p className="yabuchess-kicker">CEPHELER</p>
              <div className="yabuchess-faction-row">
                <div className="yabuchess-faction yabuchess-faction--light">
                  <span className="yabuchess-faction-dot" />
                  <strong>Tac Ordusu</strong>
                  <small>Isik, duzen, sabir</small>
                </div>
                <div className="yabuchess-faction yabuchess-faction--dark">
                  <span className="yabuchess-faction-dot" />
                  <strong>Golge Lejyonu</strong>
                  <small>Sis, kor, hucum</small>
                </div>
              </div>
            </section>

            <section className="yabuchess-card">
              <div className="yabuchess-card-head">
                <p className="yabuchess-kicker">SAVAS KAYDI</p>
                <button
                  type="button"
                  className={`yabuchess-toggle ${cinematicEnabled ? 'is-on' : ''}`}
                  onClick={() => setCinematicEnabled((value) => !value)}
                >
                  {cinematicEnabled ? 'SINEMATIK ACIK' : 'SINEMATIK KAPALI'}
                </button>
              </div>
              <div className="yabuchess-history">
                {history.length === 0 ? (
                  <p>Ilk hamleyi yap ve savasi baslat.</p>
                ) : (
                  history
                    .slice(-8)
                    .reverse()
                    .map((move, index) => (
                      <div key={`${move.san}-${index}`} className="yabuchess-history-row">
                        <span>{move.san}</span>
                        <strong>{PIECE_NAMES[move.piece]}</strong>
                      </div>
                    ))
                )}
              </div>
            </section>

            <section className="yabuchess-card">
              <p className="yabuchess-kicker">DUSEN TASLAR</p>
              <div className="yabuchess-graveyard">
                <div>
                  <span className="yabuchess-graveyard-title">Tac Ordusu</span>
                  <div className="yabuchess-graveyard-row">
                    {fallenLight.length === 0 ? (
                      <small>Hic kayip yok</small>
                    ) : (
                      fallenLight.map((piece) => (
                        <YabuChessPiece key={piece.id} piece={{ type: piece.type, color: 'w' }} />
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <span className="yabuchess-graveyard-title">Golge Lejyonu</span>
                  <div className="yabuchess-graveyard-row">
                    {fallenDark.length === 0 ? (
                      <small>Hic kayip yok</small>
                    ) : (
                      fallenDark.map((piece) => (
                        <YabuChessPiece key={piece.id} piece={{ type: piece.type, color: 'b' }} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="yabuchess-card">
              <p className="yabuchess-kicker">NOT</p>
              <p className="yabuchess-lore">
                Bu ilk YABU CHESS prototipi. Taslar canli, tahta savas masasi gibi; sonraki adim online oda,
                seyirci ve daha agir capture animasyonlari olacak.
              </p>
            </section>
          </aside>
        </section>
      </section>
    </main>
  )
}
