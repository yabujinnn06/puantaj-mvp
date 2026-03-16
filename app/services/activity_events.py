from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.audit import log_audit
from app.models import AuditActorType

MODULE_APP = "APP"
MODULE_CORE = "CORE"

EVENT_APP_LOGIN = "app_login"
EVENT_APP_LAST_SEEN = "app_last_seen"
EVENT_LOCATION_PING = "location_ping"

APP_ACTIVITY_EVENTS = {
    EVENT_APP_LOGIN,
    EVENT_APP_LAST_SEEN,
    EVENT_LOCATION_PING,
}


def app_presence_event_type(source: str | None) -> str:
    normalized = str(source or "").strip().upper()
    if normalized == "APP_CLOSE":
        return EVENT_APP_LAST_SEEN
    if normalized == "APP_OPEN":
        return EVENT_APP_LOGIN
    return EVENT_LOCATION_PING


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
