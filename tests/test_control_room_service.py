from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
import unittest

from app.models import AuditActorType, AuditLog, DepartmentShift, Employee
from app.services.control_room import _measure_from_audit, _resolve_shift_context


class ControlRoomServiceTests(unittest.TestCase):
    def test_resolve_shift_context_returns_timezone_aware_shift_window(self) -> None:
        employee = Employee(
            id=7,
            full_name="Test Personel",
            department_id=11,
            shift_id=21,
            is_active=True,
        )
        shift = DepartmentShift(
            id=21,
            department_id=11,
            name="Hafta Ici",
            start_time_local=time(9, 30),
            end_time_local=time(18, 30),
            break_minutes=60,
            is_active=True,
        )

        context = _resolve_shift_context(
            employee=employee,
            day_date=date(2026, 3, 2),
            work_rule_map={},
            weekly_rule_map=defaultdict(dict),
            weekday_shift_map={},
            shift_map=defaultdict(dict, {11: {21: shift}}),
            plan_map=defaultdict(list),
        )

        self.assertIsNotNone(context.shift_start_local)
        self.assertIsNotNone(context.shift_end_local)
        self.assertIsNotNone(context.shift_start_local.tzinfo)
        self.assertIsNotNone(context.shift_end_local.tzinfo)
        self.assertIsNotNone(context.shift_start_local.utcoffset())
        self.assertIsNotNone(context.shift_end_local.utcoffset())

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
