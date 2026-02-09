from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditActorType, AuditLog

logger = logging.getLogger("app.audit")


def log_audit(
    db: Session,
    *,
    actor_type: AuditActorType,
    actor_id: str,
    action: str,
    success: bool,
    entity_type: str | None = None,
    entity_id: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    audit = AuditLog(
        ts_utc=datetime.now(timezone.utc),
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        ip=ip,
        user_agent=user_agent,
        success=success,
        details=details or {},
    )
    db.add(audit)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "audit_log_write_failed",
            extra={
                "request_id": request_id,
                "action": action,
                "actor_type": actor_type.value,
                "actor_id": actor_id,
                "success": success,
            },
        )
        return

    logger.info(
        "audit_event",
        extra={
            "request_id": request_id,
            "action": action,
            "actor_type": actor_type.value,
            "actor_id": actor_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "ip": ip,
            "user_agent": user_agent,
            "success": success,
            "details": details or {},
        },
    )
