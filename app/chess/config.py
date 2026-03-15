from __future__ import annotations

from dataclasses import dataclass

from app.settings import get_settings


@dataclass(frozen=True, slots=True)
class ChessConfig:
    default_rating: int
    rating_k_factor: int
    rapid_clock_ms: int
    queue_ttl_seconds: int
    websocket_ping_seconds: int
    ai_move_delay_ms: int
    leaderboard_limit: int
    history_limit: int


def get_chess_config() -> ChessConfig:
    settings = get_settings()
    return ChessConfig(
        default_rating=settings.chess_default_rating,
        rating_k_factor=settings.chess_rating_k_factor,
        rapid_clock_ms=settings.chess_rapid_clock_ms,
        queue_ttl_seconds=settings.chess_queue_ttl_seconds,
        websocket_ping_seconds=settings.chess_websocket_ping_seconds,
        ai_move_delay_ms=settings.chess_ai_move_delay_ms,
        leaderboard_limit=settings.chess_leaderboard_limit,
        history_limit=settings.chess_history_limit,
    )

