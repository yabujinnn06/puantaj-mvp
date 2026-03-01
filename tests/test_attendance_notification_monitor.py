from __future__ import annotations

import unittest
from datetime import date, datetime, time, timezone, timedelta

from app.models import AttendanceEvent, AttendanceType, DepartmentShift, Employee, LocationStatus, NotificationJob
from app.services.attendance_notification_monitor import (
    AUDIENCE_ADMIN,
    TYPE_EARLY_CHECKOUT,
    TYPE_OVERRIDE_INFO,
    TYPE_OVERTIME_6H_CLOSED,
    DayAssessment,
    _create_notification_job,
    _schedule_early_checkout,
    _schedule_overtime_auto_close,
    _schedule_override_info,
)


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


def _build_assessment(*, override_active: bool, checkout_ts_utc: datetime | None) -> DayAssessment:
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
    return DayAssessment(
        employee=employee,
        local_day=date(2026, 3, 1),
        department_name="Operasyon",
        plan=None,
        shift=shift,
        default_shift=default_shift,
        first_checkin_ts_utc=datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc),
        first_checkin_source="event",
        checkout_ts_utc=checkout_ts_utc,
        checkout_source="event" if checkout_ts_utc is not None else None,
        checkout_is_manual=False,
        checkout_is_auto=False,
        shift_start_local_dt=datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc),
        shift_end_local_dt=datetime(2026, 3, 1, 18, 0, tzinfo=timezone.utc),
        default_shift_end_local_dt=datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
        grace_minutes=5,
        planned_minutes=480,
        override_active=override_active,
        override_note="Ramazan duzeni" if override_active else None,
        has_any_activity=True,
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

    def test_schedule_early_checkout_creates_two_jobs(self) -> None:
        session = _DummySession(scalar_values=[None, None])
        assessment = _build_assessment(
            override_active=False,
            checkout_ts_utc=datetime(2026, 3, 1, 14, 0, tzinfo=timezone.utc),
        )
        created_jobs: list[NotificationJob] = []

        _schedule_early_checkout(session, created_jobs=created_jobs, assessment=assessment)  # type: ignore[arg-type]

        self.assertEqual(len(created_jobs), 2)
        self.assertTrue(all(job.notification_type == TYPE_EARLY_CHECKOUT for job in created_jobs))
        self.assertEqual({job.audience for job in created_jobs}, {"employee", "admin"})

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
        session = _DummySession(scalar_values=[None, None])
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
        self.assertEqual(len(created_jobs), 2)
        self.assertTrue(all(job.notification_type == TYPE_OVERTIME_6H_CLOSED for job in created_jobs))
        self.assertGreaterEqual(len(session.added), 3)
        auto_event = session.added[0]
        self.assertIsInstance(auto_event, AttendanceEvent)
        self.assertEqual(auto_event.type, AttendanceType.OUT)
        self.assertEqual(auto_event.device_id, 17)
        self.assertEqual(auto_event.ts_utc, datetime(2026, 3, 2, 0, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
