import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js'

type PieceColor = Color
type PieceKind = PieceSymbol
type BoardSquare = Square
type GameMove = Move

interface PieceState {
  type: PieceKind
  color: PieceColor
}

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
  p: 'Piyon Darbesi',
  n: 'At Hucumu',
  b: 'Fil Kehaneti',
  r: 'Kale Ezisi',
  q: 'Vezir Firtinasi',
  k: 'Sah Hukumru',
}

const PIECE_BATTLE_COPY: Record<PieceKind, string> = {
  p: 'Mizrak savruldu, kiliclar carpisti.',
  n: 'Binici ileri atildi, toz bulutu koptu.',
  b: 'Runeler yandi, buyu savasi koptu.',
  r: 'Zirhli muhafiz kaplandi ve ezdi.',
  q: 'Pelerin savruldu, son vurus geldi.',
  k: 'Tahtin iradesi savasi tek hamlede kirdi.',
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
    return 'Tahta sustu. Savas dengede kaldi.'
  }
  const currentFaction = FACTION_NAMES[game.turn() as PieceColor]
  if (game.isCheck()) {
    return `${currentFaction} sah cekti.`
  }
  return `Sira ${currentFaction}.`
}

function YabuChessPiece({
  piece,
  size = 'board',
  isSelected,
  isTargeted,
  isMoved,
  cinematicRole,
}: {
  piece: PieceState
  size?: 'board' | 'cinematic' | 'grave'
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
        `yabuchess-piece--${size}`,
        isSelected ? 'is-selected' : '',
        isTargeted ? 'is-targeted' : '',
        isMoved ? 'is-moved' : '',
        cinematicRole ? `is-${cinematicRole}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className="yabuchess-piece-shadow" />
      <span className="yabuchess-piece-plinth" />
      <span className="yabuchess-piece-figure">
        <span className="yabuchess-piece-cape" />
        <span className="yabuchess-piece-torso" />
        <span className="yabuchess-piece-arm yabuchess-piece-arm--left" />
        <span className="yabuchess-piece-arm yabuchess-piece-arm--right" />
        <span className="yabuchess-piece-head" />
        <span className="yabuchess-piece-eye yabuchess-piece-eye--left" />
        <span className="yabuchess-piece-eye yabuchess-piece-eye--right" />
        <span className="yabuchess-piece-crown" />
        <span className="yabuchess-piece-hat" />
        <span className="yabuchess-piece-horns" />
        <span className="yabuchess-piece-weapon" />
        <span className="yabuchess-piece-shield" />
        <span className="yabuchess-piece-mount" />
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
  const recentMoves = history.slice(-4).reverse()
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
    }, 1680)
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
    <main className="yabuchess-stage-page">
      <section className="yabuchess-stage-shell">
        <div className="yabuchess-world" aria-hidden="true">
          <span className="yabuchess-world-moon" />
          <span className="yabuchess-world-ridge yabuchess-world-ridge--back" />
          <span className="yabuchess-world-ridge yabuchess-world-ridge--front" />
          <span className="yabuchess-world-tower yabuchess-world-tower--left" />
          <span className="yabuchess-world-tower yabuchess-world-tower--right" />
          <span className="yabuchess-world-banner yabuchess-world-banner--left" />
          <span className="yabuchess-world-banner yabuchess-world-banner--right" />
          <span className="yabuchess-world-mist yabuchess-world-mist--one" />
          <span className="yabuchess-world-mist yabuchess-world-mist--two" />
          <span className="yabuchess-world-flame yabuchess-world-flame--left" />
          <span className="yabuchess-world-flame yabuchess-world-flame--right" />
        </div>

        <div className="yabuchess-screen-hud">
          <div className="yabuchess-screen-brand">
            <p>WAR TABLE</p>
            <h1>YABU CHESS</h1>
          </div>
          <div className="yabuchess-screen-status">
            <span>{statusText}</span>
            <span>{latestMove ? `SON ${latestMove.san}` : 'ILK HAMLE BEKLIYOR'}</span>
            <span>{`HAMLE ${Math.max(1, Math.ceil(moveCount / 2))}`}</span>
          </div>
          <div className="yabuchess-screen-actions">
            <button type="button" className="yabuchess-screen-btn" onClick={() => navigate('/')}>
              CIK
            </button>
            <button type="button" className="yabuchess-screen-btn" onClick={undoMove}>
              GERI
            </button>
            <button type="button" className="yabuchess-screen-btn" onClick={resetBattle}>
              YENI
            </button>
          </div>
        </div>

        <section className="yabuchess-direct-stage">
          <div className="yabuchess-direct-stage-top">
            <div className="yabuchess-war-banner yabuchess-war-banner--light">
              <span className="yabuchess-war-banner-pill" />
              <strong>TAC ORDUSU</strong>
              <small>{fallenLight.length} kayip</small>
            </div>
            <button
              type="button"
              className={`yabuchess-cinematic-toggle ${cinematicEnabled ? 'is-on' : ''}`}
              onClick={() => setCinematicEnabled((value) => !value)}
            >
              {cinematicEnabled ? 'WAR SCENE ON' : 'WAR SCENE OFF'}
            </button>
            <div className="yabuchess-war-banner yabuchess-war-banner--dark">
              <span className="yabuchess-war-banner-pill" />
              <strong>GOLGE LEJYONU</strong>
              <small>{fallenDark.length} kayip</small>
            </div>
          </div>

          <div className="yabuchess-table-area">
            <div className="yabuchess-war-ticker" aria-live="polite">
              {recentMoves.length === 0 ? (
                <span className="yabuchess-war-ticker-empty">ILK HAMLE BEKLIYOR</span>
              ) : (
                recentMoves.map((move, index) => (
                  <span key={`${move.san}-${index}`} className="yabuchess-war-ticker-item">
                    <strong>{move.san}</strong>
                    <small>{PIECE_NAMES[move.piece]}</small>
                  </span>
                ))
              )}
            </div>

            <div className="yabuchess-side-rail yabuchess-side-rail--light" aria-label="Tac Ordusu kayiplari">
              <span className="yabuchess-side-rail-title">TAC</span>
              <div className="yabuchess-side-rail-pieces">
                {fallenLight.length === 0 ? (
                  <small>0</small>
                ) : (
                  fallenLight.map((piece) => (
                    <YabuChessPiece key={piece.id} piece={{ type: piece.type, color: 'w' }} size="grave" />
                  ))
                )}
              </div>
            </div>

            <div className="yabuchess-side-rail yabuchess-side-rail--dark" aria-label="Golge Lejyonu kayiplari">
              <span className="yabuchess-side-rail-title">GOLGE</span>
              <div className="yabuchess-side-rail-pieces">
                {fallenDark.length === 0 ? (
                  <small>0</small>
                ) : (
                  fallenDark.map((piece) => (
                    <YabuChessPiece key={piece.id} piece={{ type: piece.type, color: 'b' }} size="grave" />
                  ))
                )}
              </div>
            </div>

            <div className="yabuchess-table-shadow" aria-hidden="true" />
            <div className="yabuchess-war-table">
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
                          aria-label={`${square} karesi`}
                        >
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
            </div>

            <div className="yabuchess-rubble yabuchess-rubble--left" aria-hidden="true" />
            <div className="yabuchess-rubble yabuchess-rubble--right" aria-hidden="true" />

            {captureCinematic ? (
              <div className="yabuchess-war-scene" aria-live="polite">
                <div className="yabuchess-war-scene-copy">
                  <p>{CAPTURE_TITLES[captureCinematic.attackerType]}</p>
                  <h2>{captureCinematic.san}</h2>
                  <span>{PIECE_BATTLE_COPY[captureCinematic.attackerType]}</span>
                </div>
                <div className="yabuchess-war-scene-fighters">
                  <YabuChessPiece
                    piece={{ type: captureCinematic.attackerType, color: captureCinematic.attackerColor }}
                    size="cinematic"
                    cinematicRole="attacker"
                  />
                  <span className="yabuchess-war-scene-impact" aria-hidden="true" />
                  <YabuChessPiece
                    piece={{ type: captureCinematic.defenderType, color: captureCinematic.defenderColor }}
                    size="cinematic"
                    cinematicRole="defender"
                  />
                </div>
              </div>
            ) : null}

            {promotionDraft ? (
              <div className="yabuchess-war-promotion">
                <p>YUKSELME</p>
                <h2>Piyon yeni kaderini secsin</h2>
                <div className="yabuchess-war-promotion-grid">
                  {PROMOTION_CHOICES.map((pieceType) => (
                    <button
                      key={pieceType}
                      type="button"
                      className="yabuchess-war-promotion-btn"
                      onClick={() => handlePromotionChoice(pieceType)}
                    >
                      <YabuChessPiece piece={{ type: pieceType, color: promotionDraft.color }} size="grave" />
                      <span>{PIECE_NAMES[pieceType]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  )
}
