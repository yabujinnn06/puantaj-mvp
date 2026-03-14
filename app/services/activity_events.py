from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.audit import log_audit
from app.models import AuditActorType

MODULE_APP = "APP"
MODULE_GAME = "GAME"
MODULE_CORE = "CORE"

EVENT_APP_LOGIN = "app_login"
EVENT_APP_LAST_SEEN = "app_last_seen"
EVENT_GAME_LOGIN = "game_login"
EVENT_GAME_LOGOUT = "game_logout"
EVENT_GAME_SESSION_START = "game_session_start"
EVENT_GAME_SESSION_END = "game_session_end"
EVENT_LOCATION_PING = "location_ping"
EVENT_EMOJI_REACTION = "emoji_reaction"
EVENT_GAME_SCORE_UPDATE = "game_score_update"

APP_ACTIVITY_EVENTS = {
    EVENT_APP_LOGIN,
    EVENT_APP_LAST_SEEN,
    EVENT_LOCATION_PING,
}

GAME_ACTIVITY_EVENTS = {
    EVENT_GAME_LOGIN,
    EVENT_GAME_LOGOUT,
    EVENT_GAME_SESSION_START,
    EVENT_GAME_SESSION_END,
    EVENT_EMOJI_REACTION,
    EVENT_GAME_SCORE_UPDATE,
}

YABUBIRD_REACTION_EMOJIS = (
    "\U0001F600",
    "\U0001F525",
    "\U0001F44D",
)


def app_presence_event_type(source: str | None) -> str:
    normalized = (source or "").strip().upper()
    if normalized == "YABUBIRD_ENTER":
        return EVENT_GAME_LOGIN
    return EVENT_APP_LOGIN


def log_employee_activity(
    db: Session,
    *,
    employee_id: int,
    device_id: int | None,
    action: str,
    module: str,
    event_type: str,
    success: bool = True,
    entity_type: str | None = None,
    entity_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(employee_id),
        action=action,
        success=success,
        module=module,
        event_type=event_type,
        employee_id=employee_id,
        device_id=device_id,
        entity_type=entity_type,
        entity_id=entity_id,
        ip=ip,
        user_agent=user_agent,
        details=details,
        request_id=request_id,
    )
