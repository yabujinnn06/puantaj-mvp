from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
import unittest
from zoneinfo import ZoneInfo

from app.models import AttendanceEvent, AttendanceType, AuditActorType, AuditLog, DepartmentShift, Employee
from app.schemas import (
    ControlRoomEmployeeActionRequest,
    ControlRoomNoteCreateRequest,
    ControlRoomRiskOverrideRequest,
)
from app.services.control_room import (
    ScheduleContext,
    _is_heavy_overtime_day,
    _is_risk_late_checkin,
    _max_consecutive_flags,
    _measure_from_audit,
    _resolve_shift_context,
)


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

    def test_action_request_defaults_reason_and_note_when_blank(self) -> None:
        payload = ControlRoomEmployeeActionRequest(
            employee_id=7,
            action_type="REVIEW",
            reason="  ",
            note="",
            duration_days=3,
            indefinite=False,
        )

        self.assertEqual(payload.reason, "Operasyon dosyasi uzerinden manuel inceleme baslatildi.")
        self.assertEqual(payload.note, "Operasyon dosyasinda inceleme akisi baslatildi.")

    def test_risk_override_request_defaults_reason_and_note_when_missing(self) -> None:
        payload = ControlRoomRiskOverrideRequest(
            employee_id=7,
            override_score=62,
            duration_days=1,
            indefinite=False,
        )

        self.assertEqual(payload.reason, "Risk skoru manuel olarak override edildi.")
        self.assertEqual(payload.note, "Risk override islemi operasyon panelinden kaydedildi.")

    def test_note_request_defaults_message_when_blank(self) -> None:
        payload = ControlRoomNoteCreateRequest(employee_id=7, note="   ")

        self.assertEqual(payload.note, "Operasyon dosyasina admin notu eklendi.")

    def test_risk_late_checkin_starts_at_fifteen_minutes(self) -> None:
        tz = ZoneInfo("Europe/Istanbul")
        schedule = ScheduleContext(
            shift_name="Sabah",
            shift_window_label="09:00 - 18:00",
            shift_start_local=datetime(2026, 3, 2, 9, 0, tzinfo=tz),
            shift_end_local=datetime(2026, 3, 2, 18, 0, tzinfo=tz),
            planned_minutes=480,
            break_minutes=60,
            grace_minutes=5,
            overtime_grace_minutes=0,
            off_shift_tolerance_minutes=15,
            is_workday=True,
        )

        self.assertFalse(
            _is_risk_late_checkin(
                first_in=AttendanceEvent(
                    id=10,
                    employee_id=7,
                    type=AttendanceType.IN,
                    ts_utc=datetime(2026, 3, 2, 6, 14, tzinfo=timezone.utc),
                ),
                schedule=schedule,
                tz=tz,
            )
        )
        self.assertTrue(
            _is_risk_late_checkin(
                first_in=AttendanceEvent(
                    id=11,
                    employee_id=7,
                    type=AttendanceType.IN,
                    ts_utc=datetime(2026, 3, 2, 6, 15, tzinfo=timezone.utc),
                ),
                schedule=schedule,
                tz=tz,
            )
        )

    def test_heavy_overtime_requires_more_than_three_hours(self) -> None:
        schedule = ScheduleContext(
            shift_name="Sabah",
            shift_window_label="09:00 - 18:00",
            shift_start_local=datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc),
            shift_end_local=datetime(2026, 3, 2, 18, 0, tzinfo=timezone.utc),
            planned_minutes=480,
            break_minutes=60,
            grace_minutes=5,
            overtime_grace_minutes=0,
            off_shift_tolerance_minutes=15,
            is_workday=True,
        )

        self.assertFalse(
            _is_heavy_overtime_day(
                schedule=schedule,
                worked_day_minutes=660,
                has_presence=True,
            )
        )
        self.assertTrue(
            _is_heavy_overtime_day(
                schedule=schedule,
                worked_day_minutes=661,
                has_presence=True,
            )
        )

    def test_max_consecutive_flags_returns_longest_streak(self) -> None:
        self.assertEqual(_max_consecutive_flags([True, True, False, True, True, True, False]), 3)


if __name__ == "__main__":
    unittest.main()
