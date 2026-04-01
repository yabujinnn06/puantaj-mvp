from __future__ import annotations

import unittest
from datetime import date, datetime, time, timezone
from unittest.mock import patch

from app.models import AuditActorType, AuditLog, NotificationJob
from app.services.activity_events import (
    EVENT_APP_DEMO_END,
    EVENT_APP_DEMO_START,
    MODULE_APP,
)
from app.services.attendance_notification_monitor import (
    AUDIENCE_ADMIN,
    AUDIENCE_EMPLOYEE,
)
from app.services.demo_notifications import (
    TYPE_DEMO_END_REMINDER,
    TYPE_DEMO_GAP,
    TYPE_DEMO_LONG_RUNNING,
    _is_driver_department_name,
    schedule_demo_monitor_notifications,
)
from app.services.notifications import OpenShiftNotificationRecord


class _ScalarResult:
    def __init__(self, values: list[object]) -> None:
        self._values = list(values)

    def all(self) -> list[object]:
        return list(self._values)


class _DummySession:
    def __init__(
        self,
        *,
        audit_logs: list[AuditLog],
        scalar_values: list[object | None] | None = None,
    ) -> None:
        self.audit_logs = list(audit_logs)
        self.scalar_values = list(scalar_values or [])
        self.added: list[object] = []
        self.commit_count = 0
        self.refreshed: list[object] = []

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        return _ScalarResult(self.audit_logs)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, obj: object) -> None:
        self.refreshed.append(obj)


def _build_open_shift_record(*, department_name: str | None) -> OpenShiftNotificationRecord:
    return OpenShiftNotificationRecord(
        employee_id=17,
        local_day=date(2026, 4, 1),
        first_checkin_ts_utc=datetime(2026, 4, 1, 7, 0, tzinfo=timezone.utc),
        planned_checkout_ts_utc=datetime(2026, 4, 1, 15, 0, tzinfo=timezone.utc),
        shift_end_local=time(18, 0),
        grace_deadline_utc=datetime(2026, 4, 1, 15, 5, tzinfo=timezone.utc),
        escalation_deadline_utc=datetime(2026, 4, 1, 15, 35, tzinfo=timezone.utc),
        employee_full_name="Ugur Test",
        department_name=department_name,
        shift_name="Gunduz",
        shift_start_local=time(10, 0),
        checkin_outside_shift=False,
    )


def _build_demo_log(*, log_id: int, event_type: str, ts_utc: datetime) -> AuditLog:
    return AuditLog(
        id=log_id,
        ts_utc=ts_utc,
        actor_type=AuditActorType.SYSTEM,
        actor_id="system",
        module=MODULE_APP,
        event_type=event_type,
        employee_id=17,
        action="EMPLOYEE_APP_LOCATION_PING",
        success=True,
        details={},
    )


class DemoNotificationTests(unittest.TestCase):
    def test_driver_department_name_matches_normalized_keywords(self) -> None:
        self.assertTrue(_is_driver_department_name("Sürücü Operasyon"))
        self.assertTrue(_is_driver_department_name("Sofor Ekibi"))
        self.assertTrue(_is_driver_department_name("Driver Team"))
        self.assertFalse(_is_driver_department_name("Saha Operasyon"))

    def test_non_driver_department_skips_employee_demo_end_reminder(self) -> None:
        session = _DummySession(
            audit_logs=[
                _build_demo_log(
                    log_id=101,
                    event_type=EVENT_APP_DEMO_START,
                    ts_utc=datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc),
                )
            ],
            scalar_values=[None],
        )
        record = _build_open_shift_record(department_name="Saha Operasyon")

        with patch(
            "app.services.demo_notifications.get_employees_with_open_shift",
            return_value=[record],
        ):
            created_jobs = schedule_demo_monitor_notifications(
                datetime(2026, 4, 1, 12, 5, tzinfo=timezone.utc),
                db=session,  # type: ignore[arg-type]
            )

        self.assertEqual(len(created_jobs), 1)
        self.assertEqual(created_jobs[0].audience, AUDIENCE_ADMIN)
        self.assertEqual(created_jobs[0].notification_type, TYPE_DEMO_LONG_RUNNING)

    def test_non_driver_department_skips_employee_demo_gap_reminder(self) -> None:
        session = _DummySession(
            audit_logs=[
                _build_demo_log(
                    log_id=201,
                    event_type=EVENT_APP_DEMO_START,
                    ts_utc=datetime(2026, 4, 1, 8, 0, tzinfo=timezone.utc),
                ),
                _build_demo_log(
                    log_id=202,
                    event_type=EVENT_APP_DEMO_END,
                    ts_utc=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
                ),
            ],
            scalar_values=[None],
        )
        record = _build_open_shift_record(department_name="Operasyon")

        with patch(
            "app.services.demo_notifications.get_employees_with_open_shift",
            return_value=[record],
        ):
            created_jobs = schedule_demo_monitor_notifications(
                datetime(2026, 4, 1, 13, 0, tzinfo=timezone.utc),
                db=session,  # type: ignore[arg-type]
            )

        self.assertEqual(len(created_jobs), 1)
        self.assertEqual(created_jobs[0].audience, AUDIENCE_ADMIN)
        self.assertEqual(created_jobs[0].notification_type, TYPE_DEMO_GAP)

    def test_driver_department_keeps_employee_demo_notifications(self) -> None:
        session = _DummySession(
            audit_logs=[
                _build_demo_log(
                    log_id=301,
                    event_type=EVENT_APP_DEMO_START,
                    ts_utc=datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc),
                )
            ],
            scalar_values=[None, None],
        )
        record = _build_open_shift_record(department_name="Sürücü Departmanı")

        with patch(
            "app.services.demo_notifications.get_employees_with_open_shift",
            return_value=[record],
        ):
            created_jobs = schedule_demo_monitor_notifications(
                datetime(2026, 4, 1, 12, 5, tzinfo=timezone.utc),
                db=session,  # type: ignore[arg-type]
            )

        self.assertEqual(len(created_jobs), 2)
        self.assertEqual(
            {job.audience for job in created_jobs},
            {AUDIENCE_EMPLOYEE, AUDIENCE_ADMIN},
        )
        self.assertEqual(
            {job.notification_type for job in created_jobs},
            {TYPE_DEMO_END_REMINDER, TYPE_DEMO_LONG_RUNNING},
        )
        self.assertTrue(all(isinstance(job, NotificationJob) for job in created_jobs))


if __name__ == "__main__":
    unittest.main()
