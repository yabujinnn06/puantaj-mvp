from __future__ import annotations

from app.chess.config import get_chess_config
from app.chess.contracts import ChessLeaderboardResponse
from app.chess.repositories import ChessRatingRepository
from app.chess.serializers import serialize_leaderboard_row


class ChessLeaderboardService:
    def __init__(self) -> None:
        self.config = get_chess_config()

    def build_leaderboard(self, *, rating_repo: ChessRatingRepository, limit: int | None = None) -> ChessLeaderboardResponse:
        ratings = rating_repo.list_top(limit=limit or self.config.leaderboard_limit)
        return ChessLeaderboardResponse(
            items=[serialize_leaderboard_row(index + 1, rating) for index, rating in enumerate(ratings)]
        )


chess_leaderboard_service = ChessLeaderboardService()

