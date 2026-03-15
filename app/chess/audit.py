from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.chess.constants import MODULE_CHESS
from app.services.activity_events import log_employee_activity


def log_chess_activity(
    db: Session,
    *,
    employee_id: int,
    device_id: int | None,
    action: str,
    event_type: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    log_employee_activity(
        db,
        employee_id=employee_id,
        device_id=device_id,
        action=action,
        module=MODULE_CHESS,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
    )
