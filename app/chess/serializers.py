from __future__ import annotations

from collections.abc import Iterable

from app.chess.constants import ChessPlayerKind, ChessResult, ChessSide
from app.chess.contracts import (
    ChessLeaderboardEntryRead,
    ChessLegalMoveRead,
    ChessMatchStateResponse,
    ChessMatchSummaryRead,
    ChessMoveRead,
    ChessPlayerProjectionRead,
    ChessProfileRead,
    ChessQueueEntryRead,
    ChessRatingHistoryRead,
    ChessRatingRead,
)
from app.chess.models import ChessMatch, ChessMatchPlayer, ChessMatchmakingQueue, ChessMove, ChessPlayerProfile, ChessRating, ChessRatingHistory


def serialize_player(player: ChessMatchPlayer, rating: ChessRating | None = None) -> ChessPlayerProjectionRead:
    return ChessPlayerProjectionRead(
        match_player_id=player.id,
        employee_id=player.employee_id,
        display_name=player.display_name_snapshot,
        player_kind=ChessPlayerKind(player.player_kind),
        side=ChessSide(player.seat_color),
        is_host=bool(player.is_host),
        is_connected=bool(player.is_connected),
        online_status="ONLINE" if player.is_connected else "OFFLINE",
        rating=rating.current_rating if rating is not None else player.rating_after,
        peak_rating=rating.peak_rating if rating is not None else None,
        streak=rating.streak if rating is not None else None,
    )


def serialize_move(move: ChessMove) -> ChessMoveRead:
    return ChessMoveRead(
        id=move.id,
        ply_number=move.ply_number,
        san=move.san,
        uci=move.uci,
        fen_after=move.fen_after,
        played_by_player_id=move.played_by_player_id,
        played_by_name=move.played_by.display_name_snapshot if move.played_by is not None else None,
        played_at=move.played_at,
        think_time_ms=move.think_time_ms,
    )


def serialize_match_summary(match: ChessMatch) -> ChessMatchSummaryRead:
    white_player = next((item for item in match.players if item.seat_color == ChessSide.WHITE.value), None)
    black_player = next((item for item in match.players if item.seat_color == ChessSide.BLACK.value), None)
    return ChessMatchSummaryRead(
        id=match.id,
        public_code=match.public_code,
        status=match.status,
        match_type=match.match_type,
        result=match.result,
        move_count=match.move_count,
        white_player=serialize_player(white_player) if white_player is not None else None,
        black_player=serialize_player(black_player) if black_player is not None else None,
        created_at=match.created_at,
        started_at=match.started_at,
        ended_at=match.ended_at,
    )


def serialize_match_state(
    *,
    match: ChessMatch,
    you: ChessMatchPlayer,
    players: Iterable[ChessMatchPlayer],
    moves: Iterable[ChessMove],
    legal_moves: Iterable[ChessLegalMoveRead],
) -> ChessMatchStateResponse:
    return ChessMatchStateResponse(
        match=serialize_match_summary(match),
        fen=match.fen_current,
        pgn=match.pgn,
        turn=match.turn_color,
        you=serialize_player(you),
        players=[serialize_player(player) for player in players],
        moves=[serialize_move(move) for move in moves],
        legal_moves=list(legal_moves),
        draw_offer_by_side=match.draw_offer_by_side,
        white_clock_ms=match.white_clock_ms,
        black_clock_ms=match.black_clock_ms,
        result=ChessResult(match.result),
        ended_reason=match.ended_reason,
    )


def serialize_profile(
    *,
    profile: ChessPlayerProfile,
    rating: ChessRating,
    rating_history: list[ChessRatingHistory],
    recent_matches: list[ChessMatch],
) -> ChessProfileRead:
    return ChessProfileRead(
        employee_id=profile.employee_id,
        display_name=profile.display_name,
        last_seen_at=profile.last_seen_at,
        last_match_at=profile.last_match_at,
        avatar_url=profile.avatar_url,
        rating=ChessRatingRead(
            current_rating=rating.current_rating,
            peak_rating=rating.peak_rating,
            total_games=rating.total_games,
            wins=rating.wins,
            losses=rating.losses,
            draws=rating.draws,
            streak=rating.streak,
            last_rated_match_id=rating.last_rated_match_id,
        ),
        rating_history=[
            ChessRatingHistoryRead(
                id=item.id,
                match_id=item.match_id,
                previous_rating=item.previous_rating,
                new_rating=item.new_rating,
                delta=item.delta,
                result=item.result,
                created_at=item.created_at,
            )
            for item in rating_history
        ],
        recent_matches=[serialize_match_summary(match) for match in recent_matches],
    )


def serialize_queue_entry(entry: ChessMatchmakingQueue) -> ChessQueueEntryRead:
    return ChessQueueEntryRead(
        id=entry.id,
        status=entry.status,
        match_type=entry.match_type,
        preferred_side=entry.preferred_side,
        joined_at=entry.joined_at,
        expires_at=entry.expires_at,
        matched_match_id=entry.matched_match_id,
    )


def serialize_leaderboard_row(rank: int, rating: ChessRating) -> ChessLeaderboardEntryRead:
    display_name = rating.employee.full_name if rating.employee is not None and rating.employee.full_name else f"Calisan {rating.employee_id}"
    return ChessLeaderboardEntryRead(
        rank=rank,
        employee_id=rating.employee_id,
        display_name=display_name,
        current_rating=rating.current_rating,
        peak_rating=rating.peak_rating,
        streak=rating.streak,
        total_games=rating.total_games,
        wins=rating.wins,
        losses=rating.losses,
        draws=rating.draws,
    )
