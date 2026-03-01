from __future__ import annotations

from datetime import datetime, timezone
import unittest

from app.models import AuditActorType, AuditLog
from app.services.control_room import _measure_from_audit


class ControlRoomServiceTests(unittest.TestCase):
    def test_measure_from_audit_normalizes_legacy_action_types(self) -> None:
        log_item = AuditLog(
            id=1,
            ts_utc=datetime(2026, 3, 2, 0, 0, tzinfo=timezone.utc),
            actor_type=AuditActorType.ADMIN,
            actor_id="admin",
            action="CONTROL_ROOM_EMPLOYEE_ACTION",
            entity_type="employee",
            entity_id="7",
            success=True,
            details={
                "action_type": "DISABLE",
                "action_label": "Gecici Devre Disi",
                "reason": "Test",
                "note": "Legacy value",
                "duration_days": "3",
                "expires_at": "2026-03-05T12:30:00+00:00",
            },
        )

        measure = _measure_from_audit(log_item)

        self.assertEqual(measure.action_type, "DISABLE_TEMP")
        self.assertEqual(measure.duration_days, 3)
        self.assertEqual(
            measure.expires_at,
            datetime(2026, 3, 5, 12, 30, tzinfo=timezone.utc),
        )

    def test_measure_from_audit_falls_back_to_review_for_unknown_action_type(self) -> None:
        log_item = AuditLog(
            id=2,
            ts_utc=datetime(2026, 3, 2, 0, 0, tzinfo=timezone.utc),
            actor_type=AuditActorType.ADMIN,
            actor_id="admin",
            action="CONTROL_ROOM_EMPLOYEE_ACTION",
            entity_type="employee",
            entity_id="8",
            success=True,
            details={
                "action_type": "UNKNOWN_ACTION",
                "reason": "Test",
                "note": "Unknown value",
            },
        )

        measure = _measure_from_audit(log_item)

        self.assertEqual(measure.action_type, "REVIEW")


if __name__ == "__main__":
    unittest.main()
