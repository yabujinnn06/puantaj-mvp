from __future__ import annotations

from enum import Enum


class ChessMatchStatus(str, Enum):
    WAITING = "WAITING"
    ACTIVE = "ACTIVE"
    FINISHED = "FINISHED"
    ABANDONED = "ABANDONED"


class ChessMatchType(str, Enum):
    CASUAL = "CASUAL"
    RATED = "RATED"
    AI = "AI"


class ChessPlayerKind(str, Enum):
    HUMAN = "HUMAN"
    AI = "AI"


class ChessResult(str, Enum):
    ONGOING = "ONGOING"
    WHITE_WIN = "WHITE_WIN"
    BLACK_WIN = "BLACK_WIN"
    DRAW = "DRAW"


class ChessEndReason(str, Enum):
    CHECKMATE = "CHECKMATE"
    STALEMATE = "STALEMATE"
    REPETITION = "REPETITION"
    INSUFFICIENT_MATERIAL = "INSUFFICIENT_MATERIAL"
    FIFTY_MOVES = "FIFTY_MOVES"
    AGREED_DRAW = "AGREED_DRAW"
    RESIGNATION = "RESIGNATION"
    TIMEOUT = "TIMEOUT"
    ABANDONED = "ABANDONED"


class ChessQueueStatus(str, Enum):
    OPEN = "OPEN"
    MATCHED = "MATCHED"
    CANCELED = "CANCELED"


class ChessRealtimeEventType(str, Enum):
    PLAYER_JOINED = "player_joined"
    PLAYER_LEFT = "player_left"
    MOVE_SUBMITTED = "move_submitted"
    MOVE_ACCEPTED = "move_accepted"
    MOVE_REJECTED = "move_rejected"
    GAME_ENDED = "game_ended"
    DRAW_OFFERED = "draw_offered"
    RESIGN = "resign"
    TIMEOUT = "timeout"
    SNAPSHOT = "snapshot"


class ChessAIDifficulty(str, Enum):
    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"


class ChessSide(str, Enum):
    WHITE = "w"
    BLACK = "b"


MODULE_CHESS = "CHESS"

EVENT_CHESS_LOBBY_VIEWED = "chess_lobby_viewed"
EVENT_CHESS_MATCH_CREATED = "chess_match_created"
EVENT_CHESS_MATCH_JOINED = "chess_match_joined"
EVENT_CHESS_MATCH_STARTED = "chess_match_started"
EVENT_CHESS_MOVE_SUBMITTED = "chess_move_submitted"
EVENT_CHESS_MOVE_REJECTED = "chess_move_rejected"
EVENT_CHESS_MATCH_ENDED = "chess_match_ended"
EVENT_CHESS_DRAW_OFFERED = "chess_draw_offered"
EVENT_CHESS_RESIGNED = "chess_resigned"
EVENT_CHESS_QUEUE_JOINED = "chess_queue_joined"
EVENT_CHESS_QUEUE_LEFT = "chess_queue_left"
EVENT_CHESS_PROFILE_VIEWED = "chess_profile_viewed"
EVENT_CHESS_LEADERBOARD_VIEWED = "chess_leaderboard_viewed"
EVENT_CHESS_HISTORY_VIEWED = "chess_history_viewed"

CLASSIC_STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

