from __future__ import annotations

import unittest
from collections.abc import Generator
from datetime import date, datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import AttendanceExtraCheckinApproval, Employee


class _FakeDB:
    def __init__(self, employee: Employee):
        self.employee = employee

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        if model is Employee and pk == self.employee.id:
            return self.employee
        return None

    def commit(self) -> None:
        return

    def refresh(self, _obj):  # type: ignore[no-untyped-def]
        return


def _override_get_db(fake_db: _FakeDB):
    def _override() -> Generator[_FakeDB, None, None]:
        yield fake_db

    return _override


def _build_approval(status: str = "PENDING") -> AttendanceExtraCheckinApproval:
    return AttendanceExtraCheckinApproval(
        id=9,
        employee_id=1,
        device_id=12,
        local_day=date(2026, 2, 21),
        approval_token="tok_abcdefghijklmnopqrstuvwxyz_1234567890",
        status=status,
        requested_at=datetime(2026, 2, 21, 7, 10, tzinfo=timezone.utc),
        expires_at=datetime(2026, 2, 21, 8, 10, tzinfo=timezone.utc),
        approved_at=None,
        approved_by_admin_user_id=None,
        approved_by_username=None,
        consumed_at=None,
        consumed_by_event_id=None,
        push_total_targets=1,
        push_sent=1,
        push_failed=0,
        last_push_at=datetime(2026, 2, 21, 7, 10, tzinfo=timezone.utc),
    )


class ExtraCheckinApprovalEndpointsTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    @patch("app.routers.admin._normalize_extra_checkin_approval_status")
    @patch("app.routers.admin._resolve_extra_checkin_approval_by_token")
    def test_get_extra_checkin_approval_public_endpoint(
        self,
        mock_resolve_approval,
        _mock_normalize_status,
    ) -> None:
        employee = Employee(id=1, full_name="Test Employee", is_active=True)
        fake_db = _FakeDB(employee)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)

        approval = _build_approval(status="PENDING")
        mock_resolve_approval.return_value = approval

        client = TestClient(app)
        response = client.get(
            "/api/admin/attendance-extra-checkin-approval",
            params={"token": approval.approval_token},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["approval_id"], approval.id)
        self.assertEqual(body["employee_id"], employee.id)
        self.assertEqual(body["employee_name"], employee.full_name)
        self.assertEqual(body["status"], "PENDING")

    @patch("app.routers.admin.log_audit")
    @patch("app.routers.admin._authenticate_admin_identity_by_password")
    @patch("app.routers.admin._normalize_extra_checkin_approval_status")
    @patch("app.routers.admin._resolve_extra_checkin_approval_by_token")
    def test_approve_extra_checkin_approval_public_endpoint(
        self,
        mock_resolve_approval,
        _mock_normalize_status,
        mock_authenticate,
        _mock_log_audit,
    ) -> None:
        employee = Employee(id=1, full_name="Test Employee", is_active=True)
        fake_db = _FakeDB(employee)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)

        approval = _build_approval(status="PENDING")
        mock_resolve_approval.return_value = approval
        mock_authenticate.return_value = {
            "username": "admin",
            "sub": "admin",
            "admin_user_id": None,
        }

        client = TestClient(app)
        response = client.post(
            "/api/admin/attendance-extra-checkin-approval/approve",
            json={
                "token": approval.approval_token,
                "username": "admin",
                "password": "secret-password",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["already_processed"])
        self.assertEqual(body["approval"]["status"], "APPROVED")


if __name__ == "__main__":
    unittest.main()
