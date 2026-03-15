from __future__ import annotations

try:
    import chess
except ImportError:  # pragma: no cover - runtime dependency guard
    chess = None

from app.errors import ApiError


def require_chess():
    if chess is None:
        raise ApiError(
            status_code=503,
            code="CHESS_ENGINE_UNAVAILABLE",
            message="Sunucu satranc motoru hazir degil. Python 'chess' paketi gerekli.",
        )
    return chess

