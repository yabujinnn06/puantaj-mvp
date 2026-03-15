from __future__ import annotations

from app.chess.config import get_chess_config
from app.chess.contracts import ChessHistoryResponse, ChessProfileRead
from app.chess.repositories import ChessMatchRepository, ChessProfileRepository, ChessRatingRepository
from app.chess.serializers import serialize_match_summary, serialize_profile


class ChessHistoryService:
    def __init__(self) -> None:
        self.config = get_chess_config()

    def build_profile(
        self,
        *,
        employee_id: int,
        display_name: str,
        profile_repo: ChessProfileRepository,
        rating_repo: ChessRatingRepository,
        match_repo: ChessMatchRepository,
    ) -> ChessProfileRead:
        profile = profile_repo.get_or_create(employee_id=employee_id, display_name=display_name)
        rating = rating_repo.get_or_create(employee_id=employee_id, default_rating=self.config.default_rating)
        rating_history = rating_repo.list_history(employee_id=employee_id, limit=12)
        recent_matches = match_repo.list_history_for_employee(employee_id=employee_id, limit=self.config.history_limit)
        return serialize_profile(
            profile=profile,
            rating=rating,
            rating_history=rating_history,
            recent_matches=recent_matches,
        )

    def build_history(self, *, employee_id: int, match_repo: ChessMatchRepository) -> ChessHistoryResponse:
        matches = match_repo.list_history_for_employee(employee_id=employee_id, limit=self.config.history_limit)
        return ChessHistoryResponse(items=[serialize_match_summary(match) for match in matches])


chess_history_service = ChessHistoryService()
