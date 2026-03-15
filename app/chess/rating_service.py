from __future__ import annotations

from math import pow

from app.chess.config import get_chess_config
from app.chess.constants import ChessMatchType, ChessPlayerKind, ChessResult
from app.chess.models import ChessMatch, ChessMatchPlayer, ChessRatingHistory
from app.chess.repositories import ChessRatingRepository


class ChessRatingService:
    def __init__(self) -> None:
        self.config = get_chess_config()

    def apply_match_result(self, *, rating_repo: ChessRatingRepository, match: ChessMatch, players: list[ChessMatchPlayer]) -> None:
        if match.match_type != ChessMatchType.RATED.value:
            return
        human_players = [player for player in players if player.player_kind == ChessPlayerKind.HUMAN.value and player.employee_id is not None]
        if len(human_players) != 2 or match.result == ChessResult.ONGOING.value:
            return

        white_player = next((player for player in human_players if player.seat_color == "w"), None)
        black_player = next((player for player in human_players if player.seat_color == "b"), None)
        if white_player is None or black_player is None:
            return

        white_rating = rating_repo.get_or_create(employee_id=white_player.employee_id, default_rating=self.config.default_rating)
        black_rating = rating_repo.get_or_create(employee_id=black_player.employee_id, default_rating=self.config.default_rating)

        white_score = 1.0 if match.result == ChessResult.WHITE_WIN.value else 0.0 if match.result == ChessResult.BLACK_WIN.value else 0.5
        black_score = 1.0 - white_score

        white_expected = 1.0 / (1.0 + pow(10.0, (black_rating.current_rating - white_rating.current_rating) / 400.0))
        black_expected = 1.0 / (1.0 + pow(10.0, (white_rating.current_rating - black_rating.current_rating) / 400.0))

        white_before = white_rating.current_rating
        black_before = black_rating.current_rating

        white_after = round(white_before + self.config.rating_k_factor * (white_score - white_expected))
        black_after = round(black_before + self.config.rating_k_factor * (black_score - black_expected))

        self._apply_rating_row(white_rating, new_rating=white_after, result=match.result, is_white=True)
        self._apply_rating_row(black_rating, new_rating=black_after, result=match.result, is_white=False)
        white_rating.last_rated_match_id = match.id
        black_rating.last_rated_match_id = match.id

        white_player.rating_before = white_before
        white_player.rating_after = white_after
        black_player.rating_before = black_before
        black_player.rating_after = black_after

        rating_repo.add_history(
            ChessRatingHistory(
                employee_id=white_rating.employee_id,
                match_id=match.id,
                previous_rating=white_before,
                new_rating=white_after,
                delta=white_after - white_before,
                result=match.result,
            )
        )
        rating_repo.add_history(
            ChessRatingHistory(
                employee_id=black_rating.employee_id,
                match_id=match.id,
                previous_rating=black_before,
                new_rating=black_after,
                delta=black_after - black_before,
                result=match.result,
            )
        )

    def _apply_rating_row(self, rating, *, new_rating: int, result: str, is_white: bool) -> None:
        rating.current_rating = new_rating
        rating.peak_rating = max(rating.peak_rating, new_rating)
        rating.total_games += 1
        if result == ChessResult.DRAW.value:
            rating.draws += 1
            rating.streak = 0
            return
        player_won = (result == ChessResult.WHITE_WIN.value and is_white) or (result == ChessResult.BLACK_WIN.value and not is_white)
        if player_won:
            rating.wins += 1
            rating.streak = rating.streak + 1 if rating.streak >= 0 else 1
        else:
            rating.losses += 1
            rating.streak = rating.streak - 1 if rating.streak <= 0 else -1


chess_rating_service = ChessRatingService()

