import { useEffect, useMemo, useState } from 'react'

import type { BoardPiece, ChessLegalMove, ChessMatchState } from '../types'
import { parseFenPieces } from '../utils/fen'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const

function getSquareColor(square: string): 'light' | 'dark' {
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number])
  const rankIndex = RANKS.indexOf(square[1] as (typeof RANKS)[number])
  return (fileIndex + rankIndex) % 2 === 0 ? 'light' : 'dark'
}

function WarPiece({ piece }: { piece: BoardPiece }) {
  return (
    <span className={['yabuchess-piece', `yabuchess-piece--side-${piece.color}`, `yabuchess-piece--type-${piece.type}`, 'yabuchess-piece--board'].join(' ')}>
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

function findMove(moves: ChessLegalMove[], fromSquare: string, toSquare: string): ChessLegalMove | undefined {
  return moves.find((move) => move.from_square === fromSquare && move.to_square === toSquare)
}

export function BoardRenderer({
  state,
  onMove,
}: {
  state: ChessMatchState
  onMove: (input: { fromSquare: string; toSquare: string; promotion?: string | null }) => void
}) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const pieces = useMemo(() => parseFenPieces(state.fen), [state.fen])
  const pieceMap = useMemo(() => new Map(pieces.map((piece) => [piece.square, piece])), [pieces])
  const lastMove = state.moves.at(-1)
  const actorSide = state.you.side

  const legalMovesByFrom = useMemo(() => {
    const map = new Map<string, ChessLegalMove[]>()
    state.legal_moves.forEach((move) => {
      const current = map.get(move.from_square) ?? []
      current.push(move)
      map.set(move.from_square, current)
    })
    return map
  }, [state.legal_moves])

  useEffect(() => {
    setSelectedSquare(null)
  }, [state.fen])

  function handleSquarePress(square: string) {
    if (state.result !== 'ONGOING') {
      return
    }
    const selectedMoves = selectedSquare ? legalMovesByFrom.get(selectedSquare) ?? [] : []
    if (selectedSquare) {
      const planned = findMove(selectedMoves, selectedSquare, square)
      if (planned) {
        onMove({
          fromSquare: selectedSquare,
          toSquare: square,
          promotion: planned.promotion ?? null,
        })
        setSelectedSquare(null)
        return
      }
    }
    const piece = pieceMap.get(square)
    if (!piece || piece.color !== actorSide) {
      setSelectedSquare(null)
      return
    }
    if (!(legalMovesByFrom.get(square)?.length)) {
      setSelectedSquare(null)
      return
    }
    setSelectedSquare(square)
  }

  return (
    <div className="yabuchess-table-area">
      <div className="yabuchess-war-ticker">
        <span className="yabuchess-war-ticker-empty">
          {state.result === 'ONGOING' ? `SIRA ${state.turn === 'w' ? 'TAC' : 'GOLGE'}` : state.result}
        </span>
      </div>
      <div className="yabuchess-table-shadow" aria-hidden="true" />
      <div className="yabuchess-war-table">
        <div className="yabuchess-board-frame">
          <div className="yabuchess-board">
            {RANKS.flatMap((rank) =>
              FILES.map((file) => {
                const square = `${file}${rank}`
                const piece = pieceMap.get(square)
                const isSelected = selectedSquare === square
                const legalTargets = selectedSquare ? legalMovesByFrom.get(selectedSquare) ?? [] : []
                const isTarget = legalTargets.some((move) => move.to_square === square)
                const isCapture = isTarget && Boolean(piece)
                const isLastMove = lastMove?.uci.startsWith(square) || lastMove?.uci.slice(2, 4) === square

                return (
                  <button
                    key={square}
                    type="button"
                    className={[
                      'yabuchess-square',
                      `yabuchess-square--${getSquareColor(square)}`,
                      isSelected ? 'is-selected' : '',
                      isTarget ? 'is-legal' : '',
                      isCapture ? 'is-capture' : '',
                      isLastMove ? 'is-last-move' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => handleSquarePress(square)}
                    aria-label={`${square} karesi`}
                  >
                    {isTarget ? (
                      <span className={['yabuchess-square-marker', isCapture ? 'is-capture' : ''].filter(Boolean).join(' ')} />
                    ) : null}
                    {piece ? <WarPiece piece={piece} /> : null}
                  </button>
                )
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
