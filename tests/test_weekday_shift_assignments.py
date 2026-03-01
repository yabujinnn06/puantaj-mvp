from __future__ import annotations

from datetime import datetime, time, timezone
import unittest
from unittest.mock import patch

from app.models import DepartmentShift, Employee
from app.services.attendance import _infer_shift_from_checkin_time
from app.services.weekday_shift_assignments import select_employee_preferred_shift


class WeekdayShiftAssignmentsTests(unittest.TestCase):
    def test_select_employee_preferred_shift_prefers_employee_default(self) -> None:
        employee = Employee(id=7, full_name="Test User", department_id=10, shift_id=202, is_active=True)
        first_shift = DepartmentShift(
            id=201,
            department_id=10,
            name="Sabah",
            start_time_local=time(9, 0),
            end_time_local=time(18, 0),
            break_minutes=60,
            is_active=True,
        )
        second_shift = DepartmentShift(
            id=202,
            department_id=10,
            name="Geç",
            start_time_local=time(13, 0),
            end_time_local=time(22, 0),
            break_minutes=60,
            is_active=True,
        )

        selected = select_employee_preferred_shift(
            employee=employee,
            shifts=[first_shift, second_shift],
        )

        self.assertIsNotNone(selected)
        assert selected is not None
        self.assertEqual(selected.id, 202)

    def test_infer_shift_from_checkin_time_uses_weekday_assignments_first(self) -> None:
        employee = Employee(id=8, full_name="Weekday User", department_id=11, shift_id=None, is_active=True)
        weekday_shift = DepartmentShift(
            id=301,
            department_id=11,
            name="Hafta İçi",
            start_time_local=time(9, 30),
            end_time_local=time(18, 30),
            break_minutes=60,
            is_active=True,
        )

        class _DummyDB:
            pass

        with patch(
            "app.services.attendance.resolve_employee_day_shift_candidates",
            return_value=[weekday_shift],
        ):
            selected_shift, diff_minutes = _infer_shift_from_checkin_time(
                _DummyDB(),
                employee=employee,
                checkin_ts_utc=datetime(2026, 3, 2, 6, 0, tzinfo=timezone.utc),  # 09:00 local
            )

        self.assertIsNotNone(selected_shift)
        assert selected_shift is not None
        self.assertEqual(selected_shift.id, 301)
        self.assertEqual(diff_minutes, 30)


if __name__ == "__main__":
    unittest.main()
