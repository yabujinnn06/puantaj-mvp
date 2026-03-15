import type { BoardPiece } from '../types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

export function parseFenPieces(fen: string): BoardPiece[] {
  const board = fen.split(' ')[0] ?? ''
  const pieces: BoardPiece[] = []
  const ranks = board.split('/')
  ranks.forEach((rank, rankIndex) => {
    let fileIndex = 0
    for (const symbol of rank) {
      const empty = Number(symbol)
      if (Number.isFinite(empty) && empty > 0) {
        fileIndex += empty
        continue
      }
      const file = FILES[fileIndex]
      const boardRank = 8 - rankIndex
      if (file) {
        pieces.push({
          square: `${file}${boardRank}`,
          type: symbol.toLowerCase() as BoardPiece['type'],
          color: symbol === symbol.toUpperCase() ? 'w' : 'b',
        })
      }
      fileIndex += 1
    }
  })
  return pieces
}
