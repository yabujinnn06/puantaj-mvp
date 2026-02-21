from __future__ import annotations

import unittest
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import Device, DeviceInvite, Employee


class _FakeDB:
    def __init__(self, scalar_results: list[object | None]):
        self._scalar_results = scalar_results

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_results:
            return None
        return self._scalar_results.pop(0)

    def get(self, _model, _pk):  # type: ignore[no-untyped-def]
        return None

    def commit(self) -> None:
        return None

    def refresh(self, _obj) -> None:  # type: ignore[no-untyped-def]
        return None


def _override_get_db(fake_db: _FakeDB):
    def _override() -> Generator[_FakeDB, None, None]:
        yield fake_db

    return _override


class InactiveEmployeeAccessTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_checkin_rejects_inactive_employee_device(self) -> None:
        inactive_employee = Employee(
            id=11,
            full_name="Pasif Calisan",
            department_id=None,
            is_active=False,
        )
        device = Device(
            id=41,
            employee_id=11,
            device_fingerprint="inactive-fp-checkin",
            is_active=True,
        )
        device.employee = inactive_employee

        fake_db = _FakeDB([device])
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            "/api/attendance/checkin",
            json={
                "device_fingerprint": "inactive-fp-checkin",
                "qr": {"site_id": "HQ", "type": "IN"},
            },
        )

        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body["error"]["code"], "EMPLOYEE_INACTIVE")

    def test_device_claim_rejects_inactive_employee(self) -> None:
        inactive_employee = Employee(
            id=12,
            full_name="Pasif Calisan",
            department_id=None,
            is_active=False,
        )
        invite = DeviceInvite(
            id=99,
            employee_id=12,
            token="inactive-token",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            is_used=False,
        )
        invite.employee = inactive_employee

        fake_db = _FakeDB([invite])
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            "/api/device/claim",
            json={
                "token": "inactive-token",
                "device_fingerprint": "inactive-fp-claim",
            },
        )

        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body["error"]["code"], "EMPLOYEE_INACTIVE")


if __name__ == "__main__":
    unittest.main()
