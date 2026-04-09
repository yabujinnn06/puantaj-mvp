from __future__ import annotations

import hashlib
import unittest
from datetime import date, datetime, time, timezone, timedelta
from unittest.mock import patch

from app.models import AttendanceEvent, AttendanceType, DepartmentShift, Employee, LocationStatus, NotificationJob
from app.services.attendance_notification_monitor import (
    ABSENCE_ADMIN_SUMMARY_EVENT_VARIANT,
    AUDIENCE_ADMIN,
    TYPE_ABSENCE,
    TYPE_EARLY_CHECKOUT,
    TYPE_LATE_CHECKIN,
    TYPE_OVERRIDE_INFO,
    TYPE_OVERTIME_6H_CLOSED,
    DayAssessment,
    _is_checkin_outside_shift,
    _create_notification_job,
    _schedule_absence,
    _schedule_early_checkout,
    _schedule_late_checkin,
    _schedule_overtime_auto_close,
    _schedule_override_info,
)


_DEFAULT_FIRST_CHECKIN = object()


class _DummySession:
    def __init__(self, *, scalar_values: list[object | None] | None = None) -> None:
        self.scalar_values = list(scalar_values or [])
        self.added: list[object] = []
        self.flush_count = 0

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self.scalar_values:
            return None
        return self.scalar_values.pop(0)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flush_count += 1


def _build_assessment(
    *,
    override_active: bool,
    checkout_ts_utc: datetime | None,
    first_checkin_ts_utc: datetime | None | object = _DEFAULT_FIRST_CHECKIN,
    overtime_grace_minutes: int = 0,
    has_any_activity: bool = True,
) -> DayAssessment:
    employee = Employee(id=7, full_name="Ahmet Yilmaz", department_id=10, shift_id=101, is_active=True)
    shift = DepartmentShift(
        id=101,
        department_id=10,
        name="Gunduz",
        start_time_local=time(10, 0),
        end_time_local=time(18, 0),
        break_minutes=60,
        is_active=True,
    )
    default_shift = DepartmentShift(
        id=102,
        department_id=10,
        name="Varsayilan",
        start_time_local=time(10, 0),
        end_time_local=time(19, 0),
        break_minutes=60,
        is_active=True,
    )
    resolved_first_checkin = (
        datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc)
        if first_checkin_ts_utc is _DEFAULT_FIRST_CHECKIN
        else first_checkin_ts_utc
    )
    return DayAssessment(
        employee=employee,
        local_day=date(2026, 3, 1),
        region_name="Ic Anadolu",
        department_name="Operasyon",
        plan=None,
        shift=shift,
        default_shift=default_shift,
        first_checkin_ts_utc=resolved_first_checkin,
        first_checkin_source="event" if resolved_first_checkin is not None else None,
        checkout_ts_utc=checkout_ts_utc,
        checkout_source="event" if checkout_ts_utc is not None else None,
        checkout_is_manual=False,
        checkout_is_auto=False,
        shift_start_local_dt=datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc),
        shift_end_local_dt=datetime(2026, 3, 1, 18, 0, tzinfo=timezone.utc),
        default_shift_end_local_dt=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
        grace_minutes=5,
        overtime_grace_minutes=overtime_grace_minutes,
        off_shift_tolerance_minutes=0,
        planned_minutes=480,
        override_active=override_active,
        override_note="Ramazan duzeni" if override_active else None,
        has_any_activity=has_any_activity,
        checkin_outside_shift=False,
    )


class AttendanceNotificationMonitorTests(unittest.TestCase):
    def test_create_notification_job_dedupes_existing_event_hash(self) -> None:
        session = _DummySession(scalar_values=[NotificationJob(id=99, job_type="ATTENDANCE_MONITOR", scheduled_at_utc=datetime.now(timezone.utc), status="SENT", attempts=0, idempotency_key="x")])
        assessment = _build_assessment(override_active=False, checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc))

        job = _create_notification_job(
            session,  # type: ignore[arg-type]
            assessment=assessment,
            notification_type=TYPE_EARLY_CHECKOUT,
            audience=AUDIENCE_ADMIN,
            risk_level="Uyari",
            event_ts_utc=assessment.checkout_ts_utc or datetime.now(timezone.utc),
            scheduled_at_utc=assessment.checkout_ts_utc or datetime.now(timezone.utc),
            title="Erken Cikis",
            description="demo",
            actual_time_summary="demo",
            suggested_action="demo",
        )

        self.assertIsNone(job)
        self.assertEqual(session.added, [])

    def test_schedule_early_checkout_creates_admin_job_only(self) -> None:
        session = _DummySession(scalar_values=[None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc),
            first_checkin_ts_utc=datetime(2026, 3, 1, 10, 20, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_early_checkout(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        self.assertEqual(len(created_jobs), 1)
        self.assertTrue(all(job.notification_type == TYPE_EARLY_CHECKOUT for job in created_jobs))
        self.assertEqual({job.audience for job in created_jobs}, {AUDIENCE_ADMIN})

    def test_override_info_does_not_create_early_checkout_alarm(self) -> None:
        session = _DummySession(scalar_values=[None])
        assessment = _build_assessment(
            override_active=True,
            checkout_ts_utc=datetime(2026, 3, 1, 18, 30, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_early_checkout(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]
        _schedule_override_info(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        self.assertEqual(len(created_jobs), 1)
        self.assertEqual(created_jobs[0].notification_type, TYPE_OVERRIDE_INFO)
        self.assertEqual(created_jobs[0].audience, AUDIENCE_ADMIN)

    def test_overtime_auto_close_creates_checkout_event_and_notifications(self) -> None:
        session = _DummySession(scalar_values=[None])
        assessment = _build_assessment(override_active=False, checkout_ts_utc=None)
        created_jobs: list[NotificationJob] = []
        open_event = AttendanceEvent(
            id=501,
            employee_id=7,
            device_id=17,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={"SHIFT_ID": 101},
        )

        closed = _schedule_overtime_auto_close(
            session,  # type: ignore[arg-type]
            created_jobs=created_jobs,
            assessment=assessment,
            now_utc=assessment.shift_end_local_dt.astimezone(timezone.utc) + timedelta(hours=6),
            open_event=open_event,
        )

        self.assertTrue(closed)
        self.assertEqual(len(created_jobs), 1)
        self.assertTrue(all(job.notification_type == TYPE_OVERTIME_6H_CLOSED for job in created_jobs))
        self.assertEqual({job.audience for job in created_jobs}, {AUDIENCE_ADMIN})
        self.assertGreaterEqual(len(session.added), 2)
        auto_event = session.added[0]
        self.assertIsInstance(auto_event, AttendanceEvent)
        self.assertEqual(auto_event.type, AttendanceType.OUT)
        self.assertEqual(auto_event.device_id, 17)
        self.assertEqual(auto_event.ts_utc, datetime(2026, 3, 2, 0, 0, tzinfo=timezone.utc))

    def test_overtime_auto_close_respects_overtime_grace(self) -> None:
        session = _DummySession(scalar_values=[None, None])
        assessment = _build_assessment(override_active=False, checkout_ts_utc=None, overtime_grace_minutes=15)
        created_jobs: list[NotificationJob] = []
        open_event = AttendanceEvent(
            id=502,
            employee_id=7,
            device_id=17,
            type=AttendanceType.IN,
            ts_utc=datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc),
            location_status=LocationStatus.NO_LOCATION,
            flags={"SHIFT_ID": 101},
        )

        closed = _schedule_overtime_auto_close(
            session,  # type: ignore[arg-type]
            created_jobs=created_jobs,
            assessment=assessment,
            now_utc=assessment.shift_end_local_dt.astimezone(timezone.utc) + timedelta(hours=6, minutes=14),
            open_event=open_event,
        )
        self.assertFalse(closed)

        closed = _schedule_overtime_auto_close(
            session,  # type: ignore[arg-type]
            created_jobs=created_jobs,
            assessment=assessment,
            now_utc=assessment.shift_end_local_dt.astimezone(timezone.utc) + timedelta(hours=6, minutes=15),
            open_event=open_event,
        )
        self.assertTrue(closed)

    def test_off_shift_tolerance_allows_small_early_checkin(self) -> None:
        shift = DepartmentShift(
            id=301,
            department_id=10,
            name="Sabah",
            start_time_local=time(8, 30),
            end_time_local=time(17, 30),
            break_minutes=60,
            is_active=True,
        )

        result = _is_checkin_outside_shift(
            datetime(2026, 3, 1, 5, 15, tzinfo=timezone.utc),
            shift,
            off_shift_tolerance_minutes=20,
        )

        self.assertFalse(result)

    def test_late_checkin_admin_payload_contains_employee_context(self) -> None:
        session = _DummySession(scalar_values=[None, None, None, None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc),
            first_checkin_ts_utc=datetime(2026, 3, 1, 10, 20, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_late_checkin(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        self.assertEqual(len(created_jobs), 1)
        admin_job = next(job for job in created_jobs if job.audience == AUDIENCE_ADMIN)
        self.assertEqual(admin_job.notification_type, TYPE_LATE_CHECKIN)
        self.assertIn("Personel ID: #7", admin_job.description or "")
        self.assertIn("Ad Soyad: Ahmet Yilmaz", admin_job.description or "")
        self.assertIn("Bolge: Ic Anadolu", admin_job.description or "")
        self.assertEqual(admin_job.payload.get("region_name"), "Ic Anadolu")

    def test_late_checkin_escalates_after_two_consecutive_days(self) -> None:
        session = _DummySession(scalar_values=[1, None, None, None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc),
            first_checkin_ts_utc=datetime(2026, 3, 1, 10, 20, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_late_checkin(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        admin_job = next(job for job in created_jobs if job.audience == AUDIENCE_ADMIN)
        self.assertEqual(admin_job.title, "Tekrarlayan Gec Giris Tespit Edildi")
        self.assertEqual(admin_job.risk_level, "Uyari")
        self.assertEqual(admin_job.payload.get("late_streak_days"), 2)

    def test_late_checkin_becomes_critical_after_three_consecutive_days(self) -> None:
        session = _DummySession(scalar_values=[1, 1, None, None, None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc),
            first_checkin_ts_utc=datetime(2026, 3, 1, 10, 20, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_late_checkin(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        admin_job = next(job for job in created_jobs if job.audience == AUDIENCE_ADMIN)
        self.assertEqual(admin_job.title, "Tekrarlayan Gec Giris Kritik Seviyede")
        self.assertEqual(admin_job.risk_level, "Kritik")
        self.assertEqual(admin_job.payload.get("late_streak_days"), 3)

    def test_absence_triggers_daily_admin_summary_at_1600_for_admin_only(self) -> None:
        session = _DummySession(scalar_values=[None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=None,
            first_checkin_ts_utc=None,
            has_any_activity=False,
        )
        created_jobs: list[NotificationJob] = []

        with patch("app.services.attendance_notification_monitor._attendance_timezone", return_value=timezone.utc):
            _schedule_absence(
                session,  # type: ignore[arg-type]
                created_jobs=created_jobs,
                assessment=assessment,
                now_utc=datetime(2026, 3, 1, 15, 59, tzinfo=timezone.utc),
            )
            self.assertEqual(created_jobs, [])

            _schedule_absence(
                session,  # type: ignore[arg-type]
                created_jobs=created_jobs,
                assessment=assessment,
                now_utc=datetime(2026, 3, 1, 16, 0, tzinfo=timezone.utc),
            )

        self.assertEqual(len(created_jobs), 1)
        self.assertTrue(all(job.notification_type == TYPE_ABSENCE for job in created_jobs))
        self.assertEqual({job.audience for job in created_jobs}, {AUDIENCE_ADMIN})
        self.assertTrue(all(job.scheduled_at_utc == datetime(2026, 3, 1, 16, 0, tzinfo=timezone.utc) for job in created_jobs))

    def test_admin_absence_summary_uses_versioned_event_identity(self) -> None:
        session = _DummySession(scalar_values=[None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=None,
            first_checkin_ts_utc=None,
            has_any_activity=False,
        )
        created_jobs: list[NotificationJob] = []

        with patch("app.services.attendance_notification_monitor._attendance_timezone", return_value=timezone.utc):
            _schedule_absence(
                session,  # type: ignore[arg-type]
                created_jobs=created_jobs,
                assessment=assessment,
                now_utc=datetime(2026, 3, 1, 16, 0, tzinfo=timezone.utc),
            )

        self.assertEqual(len(created_jobs), 1)
        admin_job = created_jobs[0]
        legacy_hash = hashlib.sha256("7:2026-03-01:devamsizlik:admin".encode("utf-8")).hexdigest()
        self.assertNotEqual(admin_job.event_hash, legacy_hash)
        self.assertIn("DAILY_SUMMARY_V2", admin_job.event_id or "")
        self.assertEqual(admin_job.idempotency_key, admin_job.event_hash)
        self.assertEqual(ABSENCE_ADMIN_SUMMARY_EVENT_VARIANT, "daily-summary-v2")


if __name__ == "__main__":
    unittest.main()
