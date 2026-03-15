from __future__ import annotations

from datetime import datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.chess.constants import ChessMatchStatus, ChessQueueStatus
from app.chess.models import (
    ChessMatch,
    ChessMatchPlayer,
    ChessMatchmakingQueue,
    ChessMove,
    ChessPlayerProfile,
    ChessRating,
    ChessRatingHistory,
)


class ChessProfileRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_employee_id(self, employee_id: int) -> ChessPlayerProfile | None:
        return self.db.scalar(select(ChessPlayerProfile).where(ChessPlayerProfile.employee_id == employee_id))

    def get_or_create(self, *, employee_id: int, display_name: str) -> ChessPlayerProfile:
        profile = self.get_by_employee_id(employee_id)
        if profile is None:
            profile = ChessPlayerProfile(employee_id=employee_id, display_name=display_name)
            self.db.add(profile)
            self.db.flush()
        elif profile.display_name != display_name:
            profile.display_name = display_name
        return profile


class ChessRatingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_employee_id(self, employee_id: int) -> ChessRating | None:
        return self.db.scalar(select(ChessRating).where(ChessRating.employee_id == employee_id))

    def get_or_create(self, *, employee_id: int, default_rating: int) -> ChessRating:
        rating = self.get_by_employee_id(employee_id)
        if rating is None:
            rating = ChessRating(employee_id=employee_id, current_rating=default_rating, peak_rating=default_rating)
            self.db.add(rating)
            self.db.flush()
        return rating

    def list_top(self, *, limit: int) -> list[ChessRating]:
        return list(
            self.db.scalars(
                select(ChessRating)
                .options(selectinload(ChessRating.employee))
                .order_by(desc(ChessRating.current_rating), desc(ChessRating.peak_rating), ChessRating.id.asc())
                .limit(limit)
            )
        )

    def add_history(self, history: ChessRatingHistory) -> ChessRatingHistory:
        self.db.add(history)
        self.db.flush()
        return history

    def list_history(self, *, employee_id: int, limit: int) -> list[ChessRatingHistory]:
        return list(
            self.db.scalars(
                select(ChessRatingHistory)
                .where(ChessRatingHistory.employee_id == employee_id)
                .order_by(ChessRatingHistory.created_at.desc(), ChessRatingHistory.id.desc())
                .limit(limit)
            )
        )


class ChessMatchRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_match(self, match: ChessMatch) -> ChessMatch:
        self.db.add(match)
        self.db.flush()
        return match

    def add_player(self, player: ChessMatchPlayer) -> ChessMatchPlayer:
        self.db.add(player)
        self.db.flush()
        return player

    def add_move(self, move: ChessMove) -> ChessMove:
        self.db.add(move)
        self.db.flush()
        return move

    def get_match(self, match_id: int) -> ChessMatch | None:
        return self.db.scalar(
            select(ChessMatch)
            .options(
                selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.employee),
                selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.device),
                selectinload(ChessMatch.moves).selectinload(ChessMove.played_by),
            )
            .where(ChessMatch.id == match_id)
        )

    def get_match_by_code(self, public_code: str) -> ChessMatch | None:
        return self.db.scalar(
            select(ChessMatch)
            .options(selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.employee))
            .where(ChessMatch.public_code == public_code)
        )

    def list_waiting_matches(self, *, limit: int = 10) -> list[ChessMatch]:
        return list(
            self.db.scalars(
                select(ChessMatch)
                .options(selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.employee))
                .where(ChessMatch.status == ChessMatchStatus.WAITING.value)
                .order_by(ChessMatch.created_at.desc(), ChessMatch.id.desc())
                .limit(limit)
            )
        )

    def list_active_matches_for_employee(self, *, employee_id: int, limit: int = 5) -> list[ChessMatch]:
        return list(
            self.db.scalars(
                select(ChessMatch)
                .join(ChessMatchPlayer, ChessMatchPlayer.match_id == ChessMatch.id)
                .options(selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.employee))
                .where(
                    ChessMatchPlayer.employee_id == employee_id,
                    ChessMatch.status.in_([ChessMatchStatus.ACTIVE.value, ChessMatchStatus.WAITING.value]),
                )
                .order_by(ChessMatch.created_at.desc(), ChessMatch.id.desc())
                .limit(limit)
            )
        )

    def list_history_for_employee(self, *, employee_id: int, limit: int) -> list[ChessMatch]:
        return list(
            self.db.scalars(
                select(ChessMatch)
                .join(ChessMatchPlayer, ChessMatchPlayer.match_id == ChessMatch.id)
                .options(selectinload(ChessMatch.players).selectinload(ChessMatchPlayer.employee))
                .where(ChessMatchPlayer.employee_id == employee_id)
                .order_by(ChessMatch.created_at.desc(), ChessMatch.id.desc())
                .limit(limit)
            )
        )

    def get_player_for_actor(self, *, match: ChessMatch, employee_id: int, device_id: int) -> ChessMatchPlayer | None:
        for player in match.players:
            if player.player_kind == "HUMAN" and player.employee_id == employee_id and (player.device_id in (None, device_id)):
                return player
        return None


class ChessMatchmakingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_open_for_employee(self, *, employee_id: int) -> ChessMatchmakingQueue | None:
        return self.db.scalar(
            select(ChessMatchmakingQueue).where(
                ChessMatchmakingQueue.employee_id == employee_id,
                ChessMatchmakingQueue.status == ChessQueueStatus.OPEN.value,
            )
        )

    def list_open_candidates(self, *, employee_id: int, match_type: str, now: datetime) -> list[ChessMatchmakingQueue]:
        return list(
            self.db.scalars(
                select(ChessMatchmakingQueue)
                .where(
                    ChessMatchmakingQueue.employee_id != employee_id,
                    ChessMatchmakingQueue.match_type == match_type,
                    ChessMatchmakingQueue.status == ChessQueueStatus.OPEN.value,
                    ChessMatchmakingQueue.expires_at > now,
                )
                .order_by(ChessMatchmakingQueue.joined_at.asc(), ChessMatchmakingQueue.id.asc())
            )
        )

    def add(self, entry: ChessMatchmakingQueue) -> ChessMatchmakingQueue:
        self.db.add(entry)
        self.db.flush()
        return entry

    def cancel_open_entries(self, *, employee_id: int, now: datetime) -> None:
        entries = list(
            self.db.scalars(
                select(ChessMatchmakingQueue).where(
                    ChessMatchmakingQueue.employee_id == employee_id,
                    ChessMatchmakingQueue.status == ChessQueueStatus.OPEN.value,
                )
            )
        )
        for entry in entries:
            entry.status = ChessQueueStatus.CANCELED.value
            entry.canceled_at = now

    def prune_expired(self, *, now: datetime) -> None:
        entries = list(
            self.db.scalars(
                select(ChessMatchmakingQueue).where(
                    ChessMatchmakingQueue.status == ChessQueueStatus.OPEN.value,
                    ChessMatchmakingQueue.expires_at <= now,
                )
            )
        )
        for entry in entries:
            entry.status = ChessQueueStatus.CANCELED.value
            entry.canceled_at = now
