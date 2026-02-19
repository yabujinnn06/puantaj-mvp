from __future__ import annotations

import unittest
from datetime import date, datetime, time, timezone
from unittest.mock import patch

from app.models import (
    AttendanceEvent,
    AttendanceType,
    DepartmentShift,
    Employee,
    LocationStatus,
    ManualDayOverride,
    NotificationJob,
    WorkRule,
)
from app.services.notifications import (
    JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT,
    _build_message_for_job,
    get_employees_with_open_shift,
)


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeNotificationDB:
    def __init__(self, *, employees, scalar_values, get_map):
        self._employees = employees
        self._scalar_values = list(scalar_values)
        self._get_map = get_map

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        return _ScalarRows(self._employees)

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))


class NotificationServiceTests(unittest.TestCase):
    def test_open_shift_uses_istanbul_local_day_near_midnight(self) -> None:
        employee = Employee(id=1, full_name="Test User", department_id=10, shift_id=100, is_active=True)
        shift = DepartmentShift(
            id=100,
            department_id=10,
            name="Gunduz 10-18",
            start_time_local=time(10, 0),
            end_time_local=time(18, 0),
            break_minutes=60,
            is_active=True,
        )
        work_rule = WorkRule(
            id=1,
            department_id=10,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        first_in = AttendanceEvent(
            id=1,
            employee_id=1,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 8, 21, 10, tzinfo=timezone.utc),  # 2026-02-09 00:10 Europe/Istanbul
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeNotificationDB(
            employees=[employee],
            scalar_values=[
                None,      # manual override
                first_in,  # first IN event
                None,      # no OUT event -> open shift
                work_rule, # work rule
            ],
            get_map={(DepartmentShift, 100): shift},
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            results = get_employees_with_open_shift(
                now_utc=datetime(2026, 2, 8, 22, 30, tzinfo=timezone.utc),  # local day is 2026-02-09
                db=fake_db,
            )

        self.assertEqual(len(results), 1)
        record = results[0]
        self.assertEqual(record.employee_id, 1)
        self.assertEqual(record.local_day, date(2026, 2, 9))
        self.assertEqual(record.shift_end_local, time(18, 0))
        self.assertEqual(record.grace_deadline_utc, datetime(2026, 2, 9, 15, 5, tzinfo=timezone.utc))
        self.assertEqual(record.escalation_deadline_utc, datetime(2026, 2, 9, 15, 35, tzinfo=timezone.utc))

    def test_overnight_shift_deadline_rolls_to_next_utc_day(self) -> None:
        employee = Employee(id=2, full_name="Night User", department_id=11, shift_id=101, is_active=True)
        shift = DepartmentShift(
            id=101,
            department_id=11,
            name="Gece 22-06",
            start_time_local=time(22, 0),
            end_time_local=time(6, 0),
            break_minutes=30,
            is_active=True,
        )
        work_rule = WorkRule(
            id=2,
            department_id=11,
            daily_minutes_planned=480,
            break_minutes=30,
            grace_minutes=5,
        )
        first_in = AttendanceEvent(
            id=2,
            employee_id=2,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 9, 19, 30, tzinfo=timezone.utc),  # 2026-02-09 22:30 local
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeNotificationDB(
            employees=[employee],
            scalar_values=[None, first_in, None, work_rule],
            get_map={(DepartmentShift, 101): shift},
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            results = get_employees_with_open_shift(
                now_utc=datetime(2026, 2, 9, 20, 0, tzinfo=timezone.utc),  # local day: 2026-02-09
                db=fake_db,
            )

        self.assertEqual(len(results), 1)
        record = results[0]
        self.assertEqual(record.local_day, date(2026, 2, 9))
        self.assertEqual(record.shift_end_local, time(6, 0))
        self.assertEqual(record.grace_deadline_utc, datetime(2026, 2, 10, 3, 5, tzinfo=timezone.utc))
        self.assertEqual(record.escalation_deadline_utc, datetime(2026, 2, 10, 3, 35, tzinfo=timezone.utc))

    def test_manual_override_with_checkout_finalizes_day(self) -> None:
        employee = Employee(id=3, full_name="Override User", department_id=12, shift_id=None, is_active=True)
        override = ManualDayOverride(
            id=1,
            employee_id=3,
            day_date=date(2026, 2, 9),
            in_ts=datetime(2026, 2, 9, 8, 0, tzinfo=timezone.utc),
            out_ts=datetime(2026, 2, 9, 17, 0, tzinfo=timezone.utc),
            is_absent=False,
            created_by="admin",
        )

        fake_db = _FakeNotificationDB(
            employees=[employee],
            scalar_values=[override],  # should short-circuit before IN/OUT checks
            get_map={},
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            results = get_employees_with_open_shift(
                now_utc=datetime(2026, 2, 9, 10, 0, tzinfo=timezone.utc),
                db=fake_db,
            )

        self.assertEqual(results, [])

    def test_admin_escalation_message_is_detailed(self) -> None:
        employee = Employee(id=7, full_name="Hüseyincan Orman", department_id=10, shift_id=100, is_active=True)
        job = NotificationJob(
            id=44,
            employee_id=7,
            admin_user_id=None,
            job_type=JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT,
            payload={
                "employee_id": "7",
                "employee_full_name": "Hüseyincan Orman",
                "department_name": "ARGE",
                "shift_date": "2026-02-12",
                "shift_name": "Öğlen",
                "shift_window_local": "10:00-18:00",
                "first_checkin_local": "2026-02-12 10:42",
                "first_checkin_utc": "2026-02-12T07:42:00+00:00",
                "planned_checkout_time": "18:00",
                "grace_deadline_utc": "2026-02-12T15:05:00+00:00",
                "escalation_deadline_utc": "2026-02-12T15:35:00+00:00",
                "checkin_outside_shift": "true",
            },
            scheduled_at_utc=datetime(2026, 2, 12, 15, 35, tzinfo=timezone.utc),
            status="PENDING",
            attempts=0,
            idempotency_key="ADMIN_ESCALATION_MISSED_CHECKOUT:7:2026-02-12",
        )
        fake_db = _FakeNotificationDB(
            employees=[],
            scalar_values=[],
            get_map={(Employee, 7): employee},
        )

        with patch("app.services.notifications._admin_notification_emails", return_value=["admin@example.com"]):
            message = _build_message_for_job(fake_db, job)

        self.assertEqual(message.recipients, ["admin@example.com"])
        self.assertIn("Çalışan: #7 - Hüseyincan Orman", message.body)
        self.assertIn("Departman: ARGE", message.body)
        self.assertIn("Vardiya: Öğlen (10:00-18:00)", message.body)
        self.assertIn("Vardiya dışı giriş: Evet", message.body)
        self.assertIn("Giriş (yerel): 2026-02-12 10:42", message.body)
        self.assertIn("Çıkış (yerel): KAYIT YOK", message.body)


if __name__ == "__main__":
    unittest.main()
