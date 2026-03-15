from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.chess.constants import (
    ChessAIDifficulty,
    ChessMatchStatus,
    ChessMatchType,
    ChessPlayerKind,
    ChessQueueStatus,
    ChessRealtimeEventType,
    ChessResult,
    ChessSide,
)


class ChessCreateMatchRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)
    match_type: ChessMatchType = ChessMatchType.CASUAL
    opponent_mode: ChessPlayerKind = ChessPlayerKind.HUMAN
    preferred_side: ChessSide | None = None
    ai_difficulty: ChessAIDifficulty = ChessAIDifficulty.EASY


class ChessJoinMatchRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)


class ChessMoveIntentRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)
    from_square: str = Field(min_length=2, max_length=2)
    to_square: str = Field(min_length=2, max_length=2)
    promotion: str | None = Field(default=None, min_length=1, max_length=1)
    client_move_id: str | None = Field(default=None, max_length=64)


class ChessDrawOfferRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)


class ChessDrawResponseRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)
    accept: bool


class ChessResignRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)


class ChessMatchmakingEnqueueRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)
    match_type: ChessMatchType = ChessMatchType.CASUAL
    preferred_side: ChessSide | None = None


class ChessPlayerProjectionRead(BaseModel):
    match_player_id: int
    employee_id: int | None = None
    display_name: str
    player_kind: ChessPlayerKind
    side: ChessSide
    is_host: bool
    is_connected: bool
    online_status: str
    rating: int | None = None
    peak_rating: int | None = None
    streak: int | None = None
    avatar_url: str | None = None


class ChessLegalMoveRead(BaseModel):
    from_square: str
    to_square: str
    san: str
    promotion: str | None = None


class ChessMoveRead(BaseModel):
    id: int
    ply_number: int
    san: str
    uci: str
    fen_after: str
    played_by_player_id: int | None = None
    played_by_name: str | None = None
    played_at: datetime
    think_time_ms: int = 0


class ChessRatingRead(BaseModel):
    current_rating: int
    peak_rating: int
    total_games: int
    wins: int
    losses: int
    draws: int
    streak: int
    last_rated_match_id: int | None = None


class ChessRatingHistoryRead(BaseModel):
    id: int
    match_id: int
    previous_rating: int
    new_rating: int
    delta: int
    result: ChessResult
    created_at: datetime


class ChessMatchSummaryRead(BaseModel):
    id: int
    public_code: str
    status: ChessMatchStatus
    match_type: ChessMatchType
    result: ChessResult
    move_count: int
    white_player: ChessPlayerProjectionRead | None = None
    black_player: ChessPlayerProjectionRead | None = None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None


class ChessQueueEntryRead(BaseModel):
    id: int
    status: ChessQueueStatus
    match_type: ChessMatchType
    preferred_side: ChessSide | None = None
    joined_at: datetime
    expires_at: datetime
    matched_match_id: int | None = None


class ChessProfileRead(BaseModel):
    employee_id: int
    display_name: str
    last_seen_at: datetime | None = None
    last_match_at: datetime | None = None
    avatar_url: str | None = None
    rating: ChessRatingRead
    rating_history: list[ChessRatingHistoryRead] = Field(default_factory=list)
    recent_matches: list[ChessMatchSummaryRead] = Field(default_factory=list)


class ChessLeaderboardEntryRead(BaseModel):
    rank: int
    employee_id: int
    display_name: str
    current_rating: int
    peak_rating: int
    streak: int
    total_games: int
    wins: int
    losses: int
    draws: int


class ChessLobbyResponse(BaseModel):
    profile: ChessProfileRead
    waiting_matches: list[ChessMatchSummaryRead] = Field(default_factory=list)
    active_matches: list[ChessMatchSummaryRead] = Field(default_factory=list)
    leaderboard: list[ChessLeaderboardEntryRead] = Field(default_factory=list)
    queue_entry: ChessQueueEntryRead | None = None


class ChessMatchStateResponse(BaseModel):
    match: ChessMatchSummaryRead
    fen: str
    pgn: str
    turn: ChessSide
    you: ChessPlayerProjectionRead
    players: list[ChessPlayerProjectionRead]
    moves: list[ChessMoveRead] = Field(default_factory=list)
    legal_moves: list[ChessLegalMoveRead] = Field(default_factory=list)
    draw_offer_by_side: ChessSide | None = None
    white_clock_ms: int
    black_clock_ms: int
    result: ChessResult
    ended_reason: str | None = None


class ChessHistoryResponse(BaseModel):
    items: list[ChessMatchSummaryRead] = Field(default_factory=list)


class ChessLeaderboardResponse(BaseModel):
    items: list[ChessLeaderboardEntryRead] = Field(default_factory=list)


class ChessRealtimeEnvelope(BaseModel):
    event: ChessRealtimeEventType
    emitted_at: datetime
    payload: dict[str, Any]


class ChessAckResponse(BaseModel):
    ok: bool = True
    message: str | None = None
    match_id: int | None = None
