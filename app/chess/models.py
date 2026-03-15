from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models import Device, Employee


class ChessPlayerProfile(Base):
    __tablename__ = "chess_player_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_match_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    employee: Mapped["Employee"] = relationship()


class ChessMatch(Base):
    __tablename__ = "chess_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_code: Mapped[str] = mapped_column(String(12), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="WAITING", server_default=text("'WAITING'"))
    match_type: Mapped[str] = mapped_column(String(24), nullable=False, default="CASUAL", server_default=text("'CASUAL'"))
    result: Mapped[str] = mapped_column(String(24), nullable=False, default="ONGOING", server_default=text("'ONGOING'"))
    ended_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    initial_fen: Mapped[str] = mapped_column(Text, nullable=False)
    fen_current: Mapped[str] = mapped_column(Text, nullable=False)
    pgn: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    turn_color: Mapped[str] = mapped_column(String(1), nullable=False, default="w", server_default=text("'w'"))
    move_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    white_clock_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=300000, server_default=text("300000"))
    black_clock_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=300000, server_default=text("300000"))
    turn_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    draw_offer_by_side: Mapped[str | None] = mapped_column(String(1), nullable=True)
    ai_difficulty: Mapped[str | None] = mapped_column(String(16), nullable=True)
    host_employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    players: Mapped[list["ChessMatchPlayer"]] = relationship(back_populates="match", cascade="all, delete-orphan")
    moves: Mapped[list["ChessMove"]] = relationship(back_populates="match", cascade="all, delete-orphan")


class ChessMatchPlayer(Base):
    __tablename__ = "chess_match_players"
    __table_args__ = (UniqueConstraint("match_id", "seat_color", name="uq_chess_match_players_match_side"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
    player_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="HUMAN", server_default=text("'HUMAN'"))
    seat_color: Mapped[str] = mapped_column(String(1), nullable=False)
    display_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    is_host: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rating_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    match: Mapped[ChessMatch] = relationship(back_populates="players")
    employee: Mapped["Employee | None"] = relationship()
    device: Mapped["Device | None"] = relationship()
    moves: Mapped[list["ChessMove"]] = relationship(back_populates="played_by")


class ChessMove(Base):
    __tablename__ = "chess_moves"
    __table_args__ = (UniqueConstraint("match_id", "ply_number", name="uq_chess_moves_match_ply"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False, index=True)
    played_by_player_id: Mapped[int | None] = mapped_column(ForeignKey("chess_match_players.id", ondelete="SET NULL"), nullable=True, index=True)
    ply_number: Mapped[int] = mapped_column(Integer, nullable=False)
    san: Mapped[str] = mapped_column(String(32), nullable=False)
    uci: Mapped[str] = mapped_column(String(12), nullable=False)
    fen_after: Mapped[str] = mapped_column(Text, nullable=False)
    think_time_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"), index=True)

    match: Mapped[ChessMatch] = relationship(back_populates="moves")
    played_by: Mapped[ChessMatchPlayer | None] = relationship(back_populates="moves")


class ChessRating(Base):
    __tablename__ = "chess_ratings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    current_rating: Mapped[int] = mapped_column(Integer, nullable=False, default=1200, server_default=text("1200"))
    peak_rating: Mapped[int] = mapped_column(Integer, nullable=False, default=1200, server_default=text("1200"))
    streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    total_games: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    wins: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    losses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    draws: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_rated_match_id: Mapped[int | None] = mapped_column(ForeignKey("chess_matches.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    employee: Mapped["Employee"] = relationship()


class ChessRatingHistory(Base):
    __tablename__ = "chess_rating_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False, index=True)
    previous_rating: Mapped[int] = mapped_column(Integer, nullable=False)
    new_rating: Mapped[int] = mapped_column(Integer, nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    result: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"), index=True)

    employee: Mapped["Employee"] = relationship()
    match: Mapped[ChessMatch] = relationship()


class ChessMatchmakingQueue(Base):
    __tablename__ = "chess_matchmaking_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    match_type: Mapped[str] = mapped_column(String(24), nullable=False, default="CASUAL", server_default=text("'CASUAL'"))
    preferred_side: Mapped[str | None] = mapped_column(String(1), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN", server_default=text("'OPEN'"))
    matched_match_id: Mapped[int | None] = mapped_column(ForeignKey("chess_matches.id", ondelete="SET NULL"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    employee: Mapped["Employee"] = relationship()
    device: Mapped["Device"] = relationship()
    matched_match: Mapped[ChessMatch | None] = relationship()
