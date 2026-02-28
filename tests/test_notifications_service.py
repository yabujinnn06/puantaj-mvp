from __future__ import annotations

import unittest
from datetime import date, datetime, time, timezone
import os
from unittest.mock import patch

from app.models import (
    AdminDailyReportArchive,
    AttendanceEvent,
    AttendanceType,
    Department,
    DepartmentShift,
    Employee,
    LocationStatus,
    ManualDayOverride,
    NotificationJob,
    WorkRule,
)
from app.services.notifications import (
    JOB_TYPE_ADMIN_AUTO_MIDNIGHT_CHECKOUT,
    JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT,
    JOB_TYPE_ADMIN_MISSING_CHECKIN,
    JOB_TYPE_EMPLOYEE_AUTO_MIDNIGHT_CHECKOUT,
    JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT_NIGHTLY,
    _ensure_daily_report_notification_job,
    _build_message_for_job,
    get_daily_report_job_health,
    get_employees_with_missing_checkin,
    get_notification_channel_health,
    get_employees_with_open_shift,
    get_employees_with_stale_open_shift,
    repair_auto_midnight_checkout_events,
    schedule_missing_checkin_notifications,
    send_admin_notification_test_email,
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


class _FakeDailyReportJobSession:
    def __init__(self, *, existing_job: NotificationJob | None):
        self._existing_job = existing_job
        self.added: list[NotificationJob] = []

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        return self._existing_job

    def add(self, job):  # type: ignore[no-untyped-def]
        self.added.append(job)


class _FakeDailyReportHealthSession:
    def __init__(
        self,
        *,
        job: NotificationJob | None,
        archive: AdminDailyReportArchive | None = None,
    ):
        self._scalar_values = [job, archive]

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)


class _FakeMissingCheckinSession:
    def __init__(self, *, events, get_map):
        self._events = events
        self._get_map = get_map
        self.added: list[NotificationJob] = []
        self.commit_count = 0

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        return _ScalarRows(self._events)

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        return None

    def add(self, job):  # type: ignore[no-untyped-def]
        self.added.append(job)

    def commit(self) -> None:
        self.commit_count += 1


class _FakeAutoCheckoutRepairSession:
    def __init__(self, *, events, scalar_values, get_map):
        self._events = events
        self._scalar_values = list(scalar_values)
        self._get_map = get_map
        self.commit_count = 0

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        return _ScalarRows(self._events)

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))

    def commit(self) -> None:
        self.commit_count += 1


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
                first_in,  # first IN event
                None,      # no OUT event -> open shift
                None,      # no manual override
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
            scalar_values=[first_in, None, None, work_rule],
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
        first_in = AttendanceEvent(
            id=3,
            employee_id=3,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 9, 8, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
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
            scalar_values=[
                first_in,  # first IN
                None,      # no OUT
                override,  # manual override closes day
            ],
            get_map={},
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            results = get_employees_with_open_shift(
                now_utc=datetime(2026, 2, 9, 10, 0, tzinfo=timezone.utc),
                db=fake_db,
            )

        self.assertEqual(results, [])

    def test_stale_open_shift_detected_for_previous_days(self) -> None:
        employee = Employee(id=4, full_name="Stale User", department_id=13, shift_id=102, is_active=True)
        shift = DepartmentShift(
            id=102,
            department_id=13,
            name="Gunduz 09-17",
            start_time_local=time(9, 0),
            end_time_local=time(17, 0),
            break_minutes=60,
            is_active=True,
        )
        work_rule = WorkRule(
            id=3,
            department_id=13,
            daily_minutes_planned=480,
            break_minutes=60,
            grace_minutes=10,
        )
        latest_open_in = AttendanceEvent(
            id=44,
            employee_id=4,
            device_id=1,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 12, 7, 10, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )

        fake_db = _FakeNotificationDB(
            employees=[employee],
            scalar_values=[
                latest_open_in,  # latest event is open IN
                None,            # no manual override
                work_rule,       # work rule
            ],
            get_map={(DepartmentShift, 102): shift},
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            results = get_employees_with_stale_open_shift(
                now_utc=datetime(2026, 2, 23, 9, 0, tzinfo=timezone.utc),
                db=fake_db,
            )

        self.assertEqual(len(results), 1)
        record = results[0]
        self.assertEqual(record.employee_id, 4)
        self.assertEqual(record.local_day, date(2026, 2, 12))
        self.assertEqual(record.shift_end_local, time(17, 0))

    def test_missing_checkin_detected_for_out_only_day(self) -> None:
        department = Department(id=21, name="Teknik Servis")
        employee = Employee(id=11, full_name="Ercument Caliskan", department_id=21, shift_id=201, is_active=True)
        employee.department = department
        out_event = AttendanceEvent(
            id=301,
            employee_id=11,
            device_id=19,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 28, 10, 34, 44, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        out_event.employee = employee
        fake_db = _FakeMissingCheckinSession(events=[out_event], get_map={})

        records = get_employees_with_missing_checkin(
            now_utc=datetime(2026, 2, 28, 11, 0, tzinfo=timezone.utc),
            db=fake_db,  # type: ignore[arg-type]
        )
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record.employee_id, 11)
        self.assertEqual(record.local_day, date(2026, 2, 28))
        self.assertEqual(record.department_name, "Teknik Servis")

        jobs = schedule_missing_checkin_notifications(
            now_utc=datetime(2026, 2, 28, 11, 0, tzinfo=timezone.utc),
            db=fake_db,  # type: ignore[arg-type]
        )
        self.assertEqual(len(jobs), 1)
        self.assertEqual(len(fake_db.added), 1)
        created_job = fake_db.added[0]
        self.assertEqual(created_job.job_type, JOB_TYPE_ADMIN_MISSING_CHECKIN)
        self.assertEqual(created_job.payload.get("shift_date"), "2026-02-28")
        self.assertEqual(created_job.payload.get("first_checkout_local"), "2026-02-28 13:34")

    def test_missing_checkin_skips_valid_overnight_checkout(self) -> None:
        department = Department(id=22, name="Gece Ekip")
        employee = Employee(id=12, full_name="Night User", department_id=22, shift_id=202, is_active=True)
        employee.department = department
        overnight_shift = DepartmentShift(
            id=202,
            department_id=22,
            name="Gece 22-06",
            start_time_local=time(22, 0),
            end_time_local=time(6, 0),
            break_minutes=30,
            is_active=True,
        )
        in_event = AttendanceEvent(
            id=302,
            employee_id=12,
            device_id=20,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 27, 20, 30, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={"SHIFT_ID": 202},
        )
        out_event = AttendanceEvent(
            id=303,
            employee_id=12,
            device_id=20,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 28, 2, 15, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={},
        )
        in_event.employee = employee
        out_event.employee = employee
        fake_db = _FakeMissingCheckinSession(
            events=[in_event, out_event],
            get_map={(DepartmentShift, 202): overnight_shift},
        )

        records = get_employees_with_missing_checkin(
            now_utc=datetime(2026, 2, 28, 6, 0, tzinfo=timezone.utc),
            db=fake_db,  # type: ignore[arg-type]
        )
        self.assertEqual(records, [])

        jobs = schedule_missing_checkin_notifications(
            now_utc=datetime(2026, 2, 28, 6, 0, tzinfo=timezone.utc),
            db=fake_db,  # type: ignore[arg-type]
        )
        self.assertEqual(jobs, [])
        self.assertEqual(fake_db.added, [])

    def test_employee_nightly_message_contains_open_day_context(self) -> None:
        employee = Employee(id=8, full_name="Open User", department_id=10, shift_id=100, is_active=True)
        job = NotificationJob(
            id=45,
            employee_id=8,
            admin_user_id=None,
            job_type=JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT_NIGHTLY,
            payload={
                "employee_id": "8",
                "employee_full_name": "Open User",
                "employee_email": "open.user@example.com",
                "shift_date": "2026-02-12",
                "first_checkin_local": "2026-02-12 09:02",
                "planned_checkout_time": "18:00",
                "grace_deadline_utc": "2026-02-12T15:05:00+00:00",
                "escalation_deadline_utc": "2026-02-12T15:35:00+00:00",
                "nightly_reminder_local_day": "2026-02-23",
                "nightly_reminder_local_time": "21:30",
                "open_day_count": "12",
            },
            scheduled_at_utc=datetime(2026, 2, 23, 18, 30, tzinfo=timezone.utc),
            status="PENDING",
            attempts=0,
            idempotency_key="EMPLOYEE_MISSED_CHECKOUT_NIGHTLY:8:2026-02-12:2026-02-23",
        )
        fake_db = _FakeNotificationDB(
            employees=[],
            scalar_values=[],
            get_map={(Employee, 8): employee},
        )

        message = _build_message_for_job(fake_db, job)

        self.assertEqual(message.recipients, ["open.user@example.com"])
        self.assertIn("Acik kaldigi gun sayisi: 12", message.body)
        self.assertIn("Gece hatirlatma tarihi: 2026-02-23", message.body)
        self.assertIn("Cikis (yerel): KAYIT YOK", message.body)

    def test_auto_midnight_checkout_messages_include_auto_checkout_time(self) -> None:
        employee = Employee(id=9, full_name="Auto User", department_id=10, shift_id=100, is_active=True)
        employee_job = NotificationJob(
            id=46,
            employee_id=9,
            admin_user_id=None,
            job_type=JOB_TYPE_EMPLOYEE_AUTO_MIDNIGHT_CHECKOUT,
            payload={
                "employee_id": "9",
                "employee_full_name": "Auto User",
                "employee_email": "auto.user@example.com",
                "shift_date": "2026-02-12",
                "first_checkin_local": "2026-02-12 09:05",
                "auto_checkout_local": "2026-02-12 18:00",
                "open_day_count": "2",
            },
            scheduled_at_utc=datetime(2026, 2, 12, 21, 0, tzinfo=timezone.utc),
            status="PENDING",
            attempts=0,
            idempotency_key="EMPLOYEE_AUTO_MIDNIGHT_CHECKOUT:9:2026-02-12",
        )
        admin_job = NotificationJob(
            id=47,
            employee_id=9,
            admin_user_id=None,
            job_type=JOB_TYPE_ADMIN_AUTO_MIDNIGHT_CHECKOUT,
            payload={
                "employee_id": "9",
                "employee_full_name": "Auto User",
                "department_name": "ARGE",
                "shift_date": "2026-02-12",
                "shift_name": "Gunduz",
                "shift_window_local": "09:00-18:00",
                "first_checkin_local": "2026-02-12 09:05",
                "auto_checkout_local": "2026-02-12 18:00",
                "auto_checkout_utc": "2026-02-12T15:00:00+00:00",
            },
            scheduled_at_utc=datetime(2026, 2, 12, 21, 0, tzinfo=timezone.utc),
            status="PENDING",
            attempts=0,
            idempotency_key="ADMIN_AUTO_MIDNIGHT_CHECKOUT:9:2026-02-12",
        )
        fake_db = _FakeNotificationDB(
            employees=[],
            scalar_values=[],
            get_map={(Employee, 9): employee},
        )

        employee_message = _build_message_for_job(fake_db, employee_job)
        self.assertEqual(employee_message.recipients, ["auto.user@example.com"])
        self.assertIn("Otomatik cikis (yerel): 2026-02-12 18:00", employee_message.body)

        with patch("app.services.notifications._admin_notification_emails", return_value=["admin@example.com"]):
            admin_message = _build_message_for_job(fake_db, admin_job)
        self.assertEqual(admin_message.recipients, ["admin@example.com"])
        self.assertIn("Otomatik cikis (UTC): 2026-02-12T15:00:00+00:00", admin_message.body)

    def test_repair_auto_midnight_checkout_moves_old_event_to_planned_end(self) -> None:
        department = Department(id=31, name="Teknik Servis")
        shift = DepartmentShift(
            id=301,
            department_id=31,
            name="Gunduz 08:30-17:30",
            start_time_local=time(8, 30),
            end_time_local=time(17, 30),
            break_minutes=60,
            is_active=True,
        )
        employee = Employee(id=11, full_name="Repair User", department_id=31, shift_id=301, is_active=True)
        employee.department = department
        first_in_event = AttendanceEvent(
            id=401,
            employee_id=11,
            device_id=19,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 2, 13, 5, 30, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={"SHIFT_ID": 301},
        )
        auto_out_event = AttendanceEvent(
            id=402,
            employee_id=11,
            device_id=19,
            type=AttendanceType.OUT,
            ts_utc=datetime(2026, 2, 13, 21, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={
                "AUTO_CHECKOUT_AT_MIDNIGHT": True,
                "AUTO_CHECKOUT_REASON": "OPEN_SHIFT_CROSSED_MIDNIGHT",
                "SHIFT_DATE": "2026-02-13",
            },
            created_by_admin=True,
            note="Sistem gece 00:00 otomatik cikis",
        )
        auto_out_event.employee = employee
        fake_db = _FakeAutoCheckoutRepairSession(
            events=[auto_out_event],
            scalar_values=[
                first_in_event,  # first IN for repair lookup
                None,            # no manual override
                None,            # no work rule
                None,            # no employee auto job
                None,            # no admin auto job
            ],
            get_map={
                (DepartmentShift, 301): shift,
                (Department, 31): department,
            },
        )

        with patch("app.services.notifications.resolve_effective_plan_for_employee_day", return_value=None):
            repaired = repair_auto_midnight_checkout_events(
                now_utc=datetime(2026, 2, 14, 1, 0, tzinfo=timezone.utc),
                db=fake_db,  # type: ignore[arg-type]
            )

        self.assertEqual(repaired, 1)
        self.assertEqual(auto_out_event.ts_utc, datetime(2026, 2, 13, 14, 30, tzinfo=timezone.utc))
        self.assertEqual(auto_out_event.note, "Sistem gece 00:00 otomatik cikis tetikledi")
        self.assertEqual(fake_db.commit_count, 1)

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


    def test_ensure_daily_report_job_creates_when_missing(self) -> None:
        fake_session = _FakeDailyReportJobSession(existing_job=None)
        scheduled_at = datetime(2026, 2, 21, 0, 0, tzinfo=timezone.utc)

        job, state = _ensure_daily_report_notification_job(
            fake_session,  # type: ignore[arg-type]
            report_date=date(2026, 2, 20),
            archive_id=77,
            file_name="puantaj-gunluk-2026-02-20.xlsx",
            scheduled_at_utc=scheduled_at,
        )

        self.assertEqual(state, "created")
        self.assertIsNotNone(job)
        self.assertEqual(len(fake_session.added), 1)
        created_job = fake_session.added[0]
        self.assertEqual(created_job.job_type, "ADMIN_DAILY_REPORT_READY")
        self.assertEqual(created_job.status, "PENDING")
        self.assertEqual(created_job.scheduled_at_utc, scheduled_at)
        self.assertEqual(created_job.payload.get("archive_id"), 77)

    def test_ensure_daily_report_job_reactivates_failed_job(self) -> None:
        existing_job = NotificationJob(
            id=88,
            employee_id=None,
            admin_user_id=None,
            job_type="ADMIN_DAILY_REPORT_READY",
            payload={"report_date": "2026-02-19", "archive_id": 55},
            scheduled_at_utc=datetime(2026, 2, 20, 0, 0, tzinfo=timezone.utc),
            status="FAILED",
            attempts=5,
            last_error="timeout",
            idempotency_key="ADMIN_DAILY_REPORT_READY:2026-02-19",
        )
        fake_session = _FakeDailyReportJobSession(existing_job=existing_job)
        scheduled_at = datetime(2026, 2, 21, 0, 1, tzinfo=timezone.utc)

        job, state = _ensure_daily_report_notification_job(
            fake_session,  # type: ignore[arg-type]
            report_date=date(2026, 2, 19),
            archive_id=99,
            file_name="puantaj-gunluk-2026-02-19.xlsx",
            scheduled_at_utc=scheduled_at,
        )

        self.assertEqual(state, "reactivated")
        self.assertIs(job, existing_job)
        self.assertEqual(existing_job.status, "PENDING")
        self.assertEqual(existing_job.attempts, 0)
        self.assertIsNone(existing_job.last_error)
        self.assertEqual(existing_job.scheduled_at_utc, scheduled_at)
        self.assertEqual(existing_job.payload.get("archive_id"), 99)
        self.assertEqual(existing_job.payload.get("file_name"), "puantaj-gunluk-2026-02-19.xlsx")

    def test_daily_report_health_alarm_when_job_missing_after_window(self) -> None:
        fake_session = _FakeDailyReportHealthSession(job=None, archive=None)
        with patch("app.services.notifications._attendance_timezone", return_value=timezone.utc):
            result = get_daily_report_job_health(
                now_utc=datetime(2026, 2, 21, 0, 20, tzinfo=timezone.utc),
                db=fake_session,  # type: ignore[arg-type]
            )

        self.assertFalse(result["job_exists"])
        self.assertFalse(result["archive_exists"])
        self.assertIn("DAILY_REPORT_JOB_MISSING", result["alarms"])
        self.assertIn("DAILY_REPORT_ARCHIVE_MISSING", result["alarms"])

    def test_daily_report_health_alarm_for_empty_delivery(self) -> None:
        archive = AdminDailyReportArchive(
            id=55,
            report_date=date(2026, 2, 20),
            department_id=None,
            region_id=None,
            file_name="puantaj-gunluk-2026-02-20.xlsx",
            file_data=b"demo",
            file_size_bytes=4,
            employee_count=3,
            created_at=datetime(2026, 2, 21, 0, 0, tzinfo=timezone.utc),
        )
        job = NotificationJob(
            id=101,
            employee_id=None,
            admin_user_id=None,
            job_type="ADMIN_DAILY_REPORT_READY",
            payload={
                "report_date": "2026-02-20",
                "archive_id": 55,
                "delivery": {
                    "push_total_targets": 0,
                    "push_sent": 0,
                    "push_failed": 0,
                    "email_sent": 0,
                },
            },
            scheduled_at_utc=datetime(2026, 2, 21, 0, 0, tzinfo=timezone.utc),
            status="SENT",
            attempts=1,
            idempotency_key="ADMIN_DAILY_REPORT_READY:2026-02-20",
        )
        fake_session = _FakeDailyReportHealthSession(job=job, archive=archive)
        with patch("app.services.notifications._attendance_timezone", return_value=timezone.utc):
            result = get_daily_report_job_health(
                now_utc=datetime(2026, 2, 21, 0, 35, tzinfo=timezone.utc),
                db=fake_session,  # type: ignore[arg-type]
            )

        self.assertTrue(result["job_exists"])
        self.assertTrue(result["archive_exists"])
        self.assertEqual(result["archive_id"], 55)
        self.assertEqual(result["archive_employee_count"], 3)
        self.assertFalse(result["delivery_succeeded"])
        self.assertTrue(result["target_zero"])
        self.assertIn("DAILY_REPORT_DELIVERY_EMPTY", result["alarms"])
        self.assertIn("DAILY_REPORT_TARGET_ZERO", result["alarms"])
        self.assertNotIn("DAILY_REPORT_ARCHIVE_MISSING", result["alarms"])

    def test_daily_report_health_alarm_when_archive_missing_but_job_exists(self) -> None:
        job = NotificationJob(
            id=102,
            employee_id=None,
            admin_user_id=None,
            job_type="ADMIN_DAILY_REPORT_READY",
            payload={
                "report_date": "2026-02-20",
                "archive_id": 999,
                "delivery": {
                    "push_total_targets": 2,
                    "push_sent": 1,
                    "push_failed": 1,
                    "email_sent": 0,
                },
            },
            scheduled_at_utc=datetime(2026, 2, 21, 0, 0, tzinfo=timezone.utc),
            status="SENT",
            attempts=1,
            idempotency_key="ADMIN_DAILY_REPORT_READY:2026-02-20",
        )
        fake_session = _FakeDailyReportHealthSession(job=job, archive=None)
        with patch("app.services.notifications._attendance_timezone", return_value=timezone.utc):
            result = get_daily_report_job_health(
                now_utc=datetime(2026, 2, 21, 0, 40, tzinfo=timezone.utc),
                db=fake_session,  # type: ignore[arg-type]
            )

        self.assertTrue(result["job_exists"])
        self.assertFalse(result["archive_exists"])
        self.assertTrue(result["delivery_succeeded"])
        self.assertIn("DAILY_REPORT_ARCHIVE_MISSING", result["alarms"])

    def test_notification_channel_health_reports_missing_smtp_fields(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            result = get_notification_channel_health()

        email = result["email"]
        self.assertFalse(email["configured"])
        self.assertIn("SMTP_HOST", email["missing_fields"])
        self.assertIn("SMTP_FROM", email["missing_fields"])

    def test_send_admin_notification_test_email_handles_channel_exception(self) -> None:
        fake_db = _FakeNotificationDB(
            employees=[],
            scalar_values=[],
            get_map={},
        )
        with patch("app.services.notifications.EmailChannel.send", side_effect=RuntimeError("smtp_down")):
            result = send_admin_notification_test_email(
                fake_db,  # type: ignore[arg-type]
                recipients=["admin@example.com"],
                subject="test",
                body="body",
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["mode"], "send_exception")
        self.assertIn("smtp_down", str(result.get("error")))


if __name__ == "__main__":
    unittest.main()
