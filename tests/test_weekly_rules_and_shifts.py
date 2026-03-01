from __future__ import annotations

from datetime import date, datetime, time, timezone
import unittest

from app.models import (
    AttendanceEvent,
    AttendanceType,
    DepartmentShift,
    DepartmentWeekdayShiftAssignment,
    DepartmentWeeklyRule,
    Employee,
    LocationStatus,
    WorkRule,
)
from app.services.monthly import calculate_employee_monthly


class _ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeMonthlyDB:
    def __init__(self, scalar_values, scalars_values):
        self._scalar_values = list(scalar_values)
        self._scalars_values = list(scalars_values)

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalars_values:
            return _ScalarRows([])
        return _ScalarRows(self._scalars_values.pop(0))


class WeeklyRulesAndShiftsTests(unittest.TestCase):
    def test_off_day_status_when_weekly_rule_marks_non_workday(self) -> None:
        employee = Employee(id=1, full_name="Test", department_id=1, shift_id=None, is_active=True)
        work_rule = WorkRule(
            id=1,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        sunday_off = DepartmentWeeklyRule(
            id=1,
            department_id=1,
            weekday=6,
            is_workday=False,
            planned_minutes=0,
            break_minutes=0,
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [],
                [],
                [],
                [sunday_off],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=1, year=2026, month=2)
        first_day = next((day for day in report.days if day.date == date(2026, 2, 1)), None)
        self.assertIsNotNone(first_day)
        self.assertEqual(first_day.status, "OFF")
        self.assertEqual(first_day.worked_minutes, 0)

    def test_weekday_shift_assignment_overrides_legacy_weekly_off_rule(self) -> None:
        employee = Employee(id=11, full_name="Assigned User", department_id=1, shift_id=10, is_active=True)
        work_rule = WorkRule(
            id=11,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        sunday_off = DepartmentWeeklyRule(
            id=11,
            department_id=1,
            weekday=6,
            is_workday=False,
            planned_minutes=0,
            break_minutes=0,
        )
        shift = DepartmentShift(
            id=10,
            department_id=1,
            name="Pazar 09:00-14:00",
            start_time_local=time(9, 0),
            end_time_local=time(14, 0),
            break_minutes=0,
            is_active=True,
        )
        assignment = DepartmentWeekdayShiftAssignment(
            id=1,
            department_id=1,
            weekday=6,
            shift_id=10,
            sort_order=0,
            is_active=True,
        )
        assignment.shift = shift

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [],
                [],
                [],
                [sunday_off],
                [shift],
                [assignment],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=11, year=2026, month=2)
        first_day = next((day for day in report.days if day.date == date(2026, 2, 1)), None)
        self.assertIsNotNone(first_day)
        assert first_day is not None
        self.assertEqual(first_day.status, "INCOMPLETE")
        self.assertEqual(first_day.shift_id, 10)
        self.assertIn("MISSING_IN", first_day.flags)
        self.assertNotEqual(first_day.status, "OFF")

    def test_shift_assignment_changes_daily_planned_and_overtime(self) -> None:
        employee = Employee(id=2, full_name="Shift User", department_id=1, shift_id=10, is_active=True)
        work_rule = WorkRule(
            id=2,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        shift = DepartmentShift(
            id=10,
            department_id=1,
            name="Stant 10-18",
            start_time_local=time(10, 0),
            end_time_local=time(18, 0),
            break_minutes=60,
            is_active=True,
        )
        event_in = AttendanceEvent(
            id=101,
            employee_id=2,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 2, 7, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out = AttendanceEvent(
            id=102,
            employee_id=2,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 2, 16, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in, event_out],
                [],
                [],
                [],
                [shift],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=2, year=2026, month=2)
        target_day = next((day for day in report.days if day.date == date(2026, 2, 2)), None)
        self.assertIsNotNone(target_day)
        self.assertEqual(target_day.status, "OK")
        self.assertEqual(target_day.shift_id, 10)
        self.assertEqual(target_day.shift_name, "Stant 10-18")
        self.assertEqual(target_day.overtime_minutes, 60)

    def test_shift_and_weekly_rule_conflict_adds_flag(self) -> None:
        employee = Employee(id=3, full_name="Conflict User", department_id=1, shift_id=10, is_active=True)
        work_rule = WorkRule(
            id=3,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        monday_rule = DepartmentWeeklyRule(
            id=2,
            department_id=1,
            weekday=0,
            is_workday=True,
            planned_minutes=540,
            break_minutes=60,
        )
        shift = DepartmentShift(
            id=10,
            department_id=1,
            name="Stant 10-18",
            start_time_local=time(10, 0),
            end_time_local=time(18, 0),
            break_minutes=30,
            is_active=True,
        )
        event_in = AttendanceEvent(
            id=201,
            employee_id=3,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 2, 7, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out = AttendanceEvent(
            id=202,
            employee_id=3,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 2, 15, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in, event_out],
                [],
                [],
                [monday_rule],
                [shift],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=3, year=2026, month=2)
        target_day = next((day for day in report.days if day.date == date(2026, 2, 2)), None)
        self.assertIsNotNone(target_day)
        assert target_day is not None
        self.assertIn("SHIFT_WEEKLY_RULE_OVERRIDE", target_day.flags)

    def test_legal_break_enforcement_is_disabled_by_default(self) -> None:
        employee = Employee(id=4, full_name="No Break Enforce", department_id=1, shift_id=None, is_active=True)
        work_rule = WorkRule(
            id=4,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        saturday_rule = DepartmentWeeklyRule(
            id=3,
            department_id=1,
            weekday=5,
            is_workday=True,
            planned_minutes=300,
            break_minutes=0,
        )
        event_in = AttendanceEvent(
            id=301,
            employee_id=4,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 7, 6, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out = AttendanceEvent(
            id=302,
            employee_id=4,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 7, 11, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in, event_out],
                [],
                [],
                [saturday_rule],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=4, year=2026, month=2)
        saturday = next((day for day in report.days if day.date == date(2026, 2, 7)), None)
        self.assertIsNotNone(saturday)
        assert saturday is not None
        self.assertEqual(saturday.worked_minutes, 300)
        self.assertNotIn("MIN_BREAK_NOT_MET", saturday.flags)

    def test_underworked_day_has_missing_minutes_and_flag(self) -> None:
        employee = Employee(id=5, full_name="Underworked User", department_id=1, shift_id=None, is_active=True)
        work_rule = WorkRule(
            id=5,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        event_in = AttendanceEvent(
            id=401,
            employee_id=5,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 9, 6, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out = AttendanceEvent(
            id=402,
            employee_id=5,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 9, 11, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in, event_out],
                [],
                [],
                [],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=5, year=2026, month=2)
        monday = next((day for day in report.days if day.date == date(2026, 2, 9)), None)
        self.assertIsNotNone(monday)
        assert monday is not None
        self.assertEqual(monday.worked_minutes, 240)
        # planned 540 and break 60 are treated as 480 net target
        self.assertEqual(monday.missing_minutes, 240)
        self.assertIn("UNDERWORKED", monday.flags)

    def test_second_checkin_after_checkout_marks_day_incomplete(self) -> None:
        employee = Employee(id=55, full_name="Second Checkin User", department_id=1, shift_id=None, is_active=True)
        work_rule = WorkRule(
            id=55,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        event_in_1 = AttendanceEvent(
            id=551,
            employee_id=55,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 9, 6, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out_1 = AttendanceEvent(
            id=552,
            employee_id=55,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 9, 11, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_in_2 = AttendanceEvent(
            id=553,
            employee_id=55,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 9, 12, 30, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={"SECOND_CHECKIN_APPROVED": True},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in_1, event_out_1, event_in_2],
                [],
                [],
                [],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=55, year=2026, month=2)
        day = next((item for item in report.days if item.date == date(2026, 2, 9)), None)
        self.assertIsNotNone(day)
        assert day is not None
        self.assertEqual(day.status, "INCOMPLETE")
        self.assertIsNone(day.check_out)
        self.assertEqual(day.worked_minutes, 240)
        self.assertIn("OPEN_SHIFT_ACTIVE", day.flags)
        self.assertIn("MISSING_OUT", day.flags)

    def test_cross_midnight_checkout_is_attached_to_checkin_day(self) -> None:
        employee = Employee(id=6, full_name="Night Shift User", department_id=1, shift_id=None, is_active=True)
        work_rule = WorkRule(
            id=6,
            department_id=1,
            daily_minutes_planned=540,
            break_minutes=60,
            grace_minutes=5,
        )
        # Europe/Istanbul local:
        # IN  : 2026-02-10 23:30
        # OUT : 2026-02-11 01:15
        event_in = AttendanceEvent(
            id=601,
            employee_id=6,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 10, 20, 30, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        event_out = AttendanceEvent(
            id=602,
            employee_id=6,
            device_id=1,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 10, 22, 15, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeMonthlyDB(
            scalar_values=[employee, work_rule, None],
            scalars_values=[
                [event_in, event_out],
                [],
                [],
                [],
                [],
            ],
        )

        report = calculate_employee_monthly(fake_db, employee_id=6, year=2026, month=2)
        target_day = next((day for day in report.days if day.date == date(2026, 2, 10)), None)
        self.assertIsNotNone(target_day)
        assert target_day is not None
        self.assertEqual(target_day.check_in, event_in.ts_utc)
        self.assertEqual(target_day.check_out, event_out.ts_utc)
        self.assertIn("CROSS_MIDNIGHT_CHECKOUT", target_day.flags)


if __name__ == "__main__":
    unittest.main()
