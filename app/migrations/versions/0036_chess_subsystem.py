"""add chess subsystem tables

Revision ID: 0036_chess_subsystem
Revises: 0035_yabubird_room_owners
Create Date: 2026-03-15 20:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0036_chess_subsystem"
down_revision = "0035_yabubird_room_owners"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chess_player_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_match_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("employee_id", name="uq_chess_player_profiles_employee_id"),
    )
    op.create_index("ix_chess_player_profiles_employee_id", "chess_player_profiles", ["employee_id"], unique=True)

    op.create_table(
        "chess_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_code", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'WAITING'")),
        sa.Column("match_type", sa.String(length=24), nullable=False, server_default=sa.text("'CASUAL'")),
        sa.Column("result", sa.String(length=24), nullable=False, server_default=sa.text("'ONGOING'")),
        sa.Column("ended_reason", sa.String(length=32), nullable=True),
        sa.Column("initial_fen", sa.Text(), nullable=False),
        sa.Column("fen_current", sa.Text(), nullable=False),
        sa.Column("pgn", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("turn_color", sa.String(length=1), nullable=False, server_default=sa.text("'w'")),
        sa.Column("move_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("white_clock_ms", sa.Integer(), nullable=False, server_default=sa.text("300000")),
        sa.Column("black_clock_ms", sa.Integer(), nullable=False, server_default=sa.text("300000")),
        sa.Column("turn_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("draw_offer_by_side", sa.String(length=1), nullable=True),
        sa.Column("ai_difficulty", sa.String(length=16), nullable=True),
        sa.Column("host_employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("public_code", name="uq_chess_matches_public_code"),
    )
    op.create_index("ix_chess_matches_public_code", "chess_matches", ["public_code"], unique=True)
    op.create_index("ix_chess_matches_created_at", "chess_matches", ["created_at"])

    op.create_table(
        "chess_match_players",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL"), nullable=True),
        sa.Column("device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("player_kind", sa.String(length=16), nullable=False, server_default=sa.text("'HUMAN'")),
        sa.Column("seat_color", sa.String(length=1), nullable=False),
        sa.Column("display_name_snapshot", sa.String(length=255), nullable=False),
        sa.Column("is_host", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_connected", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rating_before", sa.Integer(), nullable=True),
        sa.Column("rating_after", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("match_id", "seat_color", name="uq_chess_match_players_match_side"),
    )
    op.create_index("ix_chess_match_players_match_id", "chess_match_players", ["match_id"])
    op.create_index("ix_chess_match_players_employee_id", "chess_match_players", ["employee_id"])
    op.create_index("ix_chess_match_players_device_id", "chess_match_players", ["device_id"])

    op.create_table(
        "chess_moves",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("played_by_player_id", sa.Integer(), sa.ForeignKey("chess_match_players.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ply_number", sa.Integer(), nullable=False),
        sa.Column("san", sa.String(length=32), nullable=False),
        sa.Column("uci", sa.String(length=12), nullable=False),
        sa.Column("fen_after", sa.Text(), nullable=False),
        sa.Column("think_time_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("match_id", "ply_number", name="uq_chess_moves_match_ply"),
    )
    op.create_index("ix_chess_moves_match_id", "chess_moves", ["match_id"])
    op.create_index("ix_chess_moves_played_by_player_id", "chess_moves", ["played_by_player_id"])
    op.create_index("ix_chess_moves_played_at", "chess_moves", ["played_at"])

    op.create_table(
        "chess_ratings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_rating", sa.Integer(), nullable=False, server_default=sa.text("1200")),
        sa.Column("peak_rating", sa.Integer(), nullable=False, server_default=sa.text("1200")),
        sa.Column("streak", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_games", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("wins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("losses", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("draws", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_rated_match_id", sa.Integer(), sa.ForeignKey("chess_matches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("employee_id", name="uq_chess_ratings_employee_id"),
    )
    op.create_index("ix_chess_ratings_employee_id", "chess_ratings", ["employee_id"], unique=True)

    op.create_table(
        "chess_rating_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_id", sa.Integer(), sa.ForeignKey("chess_matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("previous_rating", sa.Integer(), nullable=False),
        sa.Column("new_rating", sa.Integer(), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("result", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_chess_rating_history_employee_id", "chess_rating_history", ["employee_id"])
    op.create_index("ix_chess_rating_history_match_id", "chess_rating_history", ["match_id"])
    op.create_index("ix_chess_rating_history_created_at", "chess_rating_history", ["created_at"])

    op.create_table(
        "chess_matchmaking_queue",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_type", sa.String(length=24), nullable=False, server_default=sa.text("'CASUAL'")),
        sa.Column("preferred_side", sa.String(length=1), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'OPEN'")),
        sa.Column("matched_match_id", sa.Integer(), sa.ForeignKey("chess_matches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("matched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_chess_matchmaking_queue_employee_id", "chess_matchmaking_queue", ["employee_id"])
    op.create_index("ix_chess_matchmaking_queue_device_id", "chess_matchmaking_queue", ["device_id"])
    op.create_index("ix_chess_matchmaking_queue_joined_at", "chess_matchmaking_queue", ["joined_at"])


def downgrade() -> None:
    op.drop_index("ix_chess_matchmaking_queue_joined_at", table_name="chess_matchmaking_queue")
    op.drop_index("ix_chess_matchmaking_queue_device_id", table_name="chess_matchmaking_queue")
    op.drop_index("ix_chess_matchmaking_queue_employee_id", table_name="chess_matchmaking_queue")
    op.drop_table("chess_matchmaking_queue")

    op.drop_index("ix_chess_rating_history_created_at", table_name="chess_rating_history")
    op.drop_index("ix_chess_rating_history_match_id", table_name="chess_rating_history")
    op.drop_index("ix_chess_rating_history_employee_id", table_name="chess_rating_history")
    op.drop_table("chess_rating_history")

    op.drop_index("ix_chess_ratings_employee_id", table_name="chess_ratings")
    op.drop_table("chess_ratings")

    op.drop_index("ix_chess_moves_played_at", table_name="chess_moves")
    op.drop_index("ix_chess_moves_played_by_player_id", table_name="chess_moves")
    op.drop_index("ix_chess_moves_match_id", table_name="chess_moves")
    op.drop_table("chess_moves")

    op.drop_index("ix_chess_match_players_device_id", table_name="chess_match_players")
    op.drop_index("ix_chess_match_players_employee_id", table_name="chess_match_players")
    op.drop_index("ix_chess_match_players_match_id", table_name="chess_match_players")
    op.drop_table("chess_match_players")

    op.drop_index("ix_chess_matches_created_at", table_name="chess_matches")
    op.drop_index("ix_chess_matches_public_code", table_name="chess_matches")
    op.drop_table("chess_matches")

    op.drop_index("ix_chess_player_profiles_employee_id", table_name="chess_player_profiles")
    op.drop_table("chess_player_profiles")
