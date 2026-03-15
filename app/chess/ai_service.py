from __future__ import annotations

import random

from app.chess.constants import ChessAIDifficulty
from app.chess.engine import require_chess


PIECE_WEIGHTS = {
    "p": 100,
    "n": 320,
    "b": 330,
    "r": 500,
    "q": 900,
    "k": 20_000,
}


class ChessAIService:
    def choose_move(self, *, fen: str, difficulty: ChessAIDifficulty) -> str:
        chess = require_chess()
        board = chess.Board(fen)
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            raise ValueError("AI icin yasal hamle yok.")

        if difficulty == ChessAIDifficulty.EASY:
            return random.choice(legal_moves).uci()

        scored_moves: list[tuple[int, str]] = []
        for move in legal_moves:
            score = self._evaluate_move(board, move)
            scored_moves.append((score, move.uci()))
        scored_moves.sort(key=lambda item: item[0], reverse=True)

        if difficulty == ChessAIDifficulty.MEDIUM:
            top_score = scored_moves[0][0]
            shortlist = [uci for score, uci in scored_moves[:6] if score >= top_score - 120]
            return random.choice(shortlist)

        return scored_moves[0][1]

    def _evaluate_move(self, board, move) -> int:
        chess = require_chess()
        score = 0
        captured_piece = board.piece_at(move.to_square)
        if captured_piece is not None:
            score += PIECE_WEIGHTS.get(captured_piece.symbol().lower(), 0) * 4

        if board.gives_check(move):
            score += 180

        if board.is_castling(move):
            score += 60

        board.push(move)
        if board.is_checkmate():
            score += 100_000
        else:
            material = 0
            for square, piece in board.piece_map().items():
                del square
                value = PIECE_WEIGHTS.get(piece.symbol().lower(), 0)
                material += value if piece.color == board.turn else -value
            score += -material
        board.pop()
        return score


chess_ai_service = ChessAIService()

