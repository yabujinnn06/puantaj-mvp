from __future__ import annotations

import unittest
from collections.abc import Generator
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import AttendanceType, LocationStatus


class _FakeDB:
    def commit(self) -> None:
        return None

    def refresh(self, _obj) -> None:  # type: ignore[no-untyped-def]
        return None

    def add(self, _obj) -> None:  # type: ignore[no-untyped-def]
        return None

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        return None

    def get(self, _model, _pk):  # type: ignore[no-untyped-def]
        return None


def _override_get_db(fake_db: _FakeDB):
    def _override() -> Generator[_FakeDB, None, None]:
        yield fake_db

    return _override


def _event(*, event_type: AttendanceType) -> SimpleNamespace:
    return SimpleNamespace(
        id=501,
        employee_id=33,
        type=event_type,
        ts_utc=datetime(2026, 4, 8, 8, 30, tzinfo=timezone.utc),
        location_status=LocationStatus.NO_LOCATION,
        flags={},
    )


class EmployeeAttendancePushTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_checkin_sends_shift_started_push(self) -> None:
        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        with (
            patch("app.routers.attendance.create_checkin_event", return_value=_event(event_type=AttendanceType.IN)),
            patch("app.routers.attendance.log_audit"),
            patch("app.routers.attendance.send_push_to_employees", return_value={"total_targets": 1}) as push_mock,
        ):
            response = client.post(
                "/api/attendance/checkin",
                json={
                    "device_fingerprint": "employee-fp",
                    "qr": {"site_id": "HQ", "type": "IN"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        push_mock.assert_called_once()
        _, kwargs = push_mock.call_args
        self.assertEqual(kwargs["employee_ids"], [33])
        self.assertEqual(kwargs["title"], "Mesainiz başladı")
        self.assertEqual(kwargs["body"], "Giriş kaydınız başarıyla alındı.")
        self.assertEqual(kwargs["data"]["type"], "ATTENDANCE_SHIFT_STARTED")
        self.assertEqual(kwargs["data"]["url"], "/employee/")
        self.assertNotIn("fazla mesai", kwargs["body"].lower())

    def test_qr_checkout_sends_shift_ended_push(self) -> None:
        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        with (
            patch("app.routers.attendance.create_employee_qr_scan_event", return_value=_event(event_type=AttendanceType.OUT)),
            patch("app.routers.attendance.log_audit"),
            patch("app.routers.attendance.send_push_to_employees", return_value={"total_targets": 1}) as push_mock,
        ):
            response = client.post(
                "/api/employee/qr/scan",
                json={
                    "device_fingerprint": "employee-fp",
                    "code_value": "qr-123",
                    "lat": 41.0,
                    "lon": 29.0,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["event_type"], "OUT")
        push_mock.assert_called_once()
        _, kwargs = push_mock.call_args
        self.assertEqual(kwargs["employee_ids"], [33])
        self.assertEqual(kwargs["title"], "Mesainiz bitti")
        self.assertEqual(kwargs["body"], "Çıkış kaydınız başarıyla alındı.")
        self.assertEqual(kwargs["data"]["type"], "ATTENDANCE_SHIFT_ENDED")
        self.assertNotIn("fazla mesai", kwargs["body"].lower())

    def test_checkin_still_succeeds_when_push_send_fails(self) -> None:
        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        with (
            patch("app.routers.attendance.create_checkin_event", return_value=_event(event_type=AttendanceType.IN)),
            patch("app.routers.attendance.log_audit"),
            patch("app.routers.attendance.send_push_to_employees", side_effect=RuntimeError("push down")),
        ):
            response = client.post(
                "/api/attendance/checkin",
                json={
                    "device_fingerprint": "employee-fp",
                    "qr": {"site_id": "HQ", "type": "IN"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])


if __name__ == "__main__":
    unittest.main()
