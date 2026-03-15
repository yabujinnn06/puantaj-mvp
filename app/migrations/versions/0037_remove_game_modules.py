"""remove game module tables and audit traces

Revision ID: 0037_remove_game_modules
Revises: 0036_chess_subsystem
Create Date: 2026-03-15 22:45:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0037_remove_game_modules"
down_revision = "0036_chess_subsystem"
branch_labels = None
depends_on = None


GAME_TABLES = [
    "chess_matchmaking_queue",
    "chess_rating_history",
    "chess_ratings",
    "chess_moves",
    "chess_match_players",
    "chess_matches",
    "chess_player_profiles",
    "yabubird_reactions",
    "yabubird_scores",
    "yabubird_presences",
    "yabubird_rooms",
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    op.execute(
        sa.text(
            """
            DELETE FROM audit_logs
            WHERE module IN ('GAME', 'CHESS')
               OR action IN (
                   'YABUBIRD_JOINED',
                   'YABUBIRD_FINISHED',
                   'YABUBIRD_LEFT',
                   'YABUBIRD_REACTION'
               )
               OR event_type IN (
                   'game_login',
                   'game_logout',
                   'game_session_start',
                   'game_session_end',
                   'emoji_reaction',
                   'game_score_update'
               )
               OR event_type LIKE 'chess_%'
               OR entity_type LIKE 'yabubird_%'
               OR entity_type LIKE 'chess_%'
               OR CAST(details AS TEXT) LIKE '%YABUBIRD_ENTER%'
            """
        )
    )

    for table_name in GAME_TABLES:
        if table_name in existing_tables:
            op.drop_table(table_name)


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported after removing game modules.")
