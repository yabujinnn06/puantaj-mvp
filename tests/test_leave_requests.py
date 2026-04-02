from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.models import Device, Employee, Leave, LeaveStatus, LeaveType
from app.schemas import EmployeeLeaveRequestCreate, LeaveDecisionRequest
from app.services.leaves import create_employee_leave_request, decide_leave


class _FakeLeaveDB:
    def __init__(
        self,
        *,
        scalar_values: list[object | None] | None = None,
        get_map: dict[tuple[type[object], int], object] | None = None,
    ) -> None:
        self._scalar_values = list(scalar_values or [])
        self._get_map = dict(get_map or {})
        self.added: list[object] = []
        self.commit_count = 0
        self.refreshed: list[object] = []
        self._next_id = 1000

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))

    def add(self, obj: object) -> None:
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            setattr(obj, "id", self._next_id)
            self._next_id += 1
        self.added.append(obj)

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, obj: object) -> None:
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            setattr(obj, "id", self._next_id)
            self._next_id += 1
        self.refreshed.append(obj)


def _build_employee() -> Employee:
    return Employee(
        id=7,
        full_name="Test Employee",
        department_id=None,
        region_id=None,
        is_active=True,
    )


def _build_device(employee: Employee) -> Device:
    device = Device(
        id=17,
        employee_id=employee.id,
        device_fingerprint="employee-device-123",
        is_active=True,
    )
    device.employee = employee
    return device


class LeaveRequestServiceTests(unittest.TestCase):
    def test_employee_leave_request_creates_pending_leave_and_notifies_admins(self) -> None:
        employee = _build_employee()
        device = _build_device(employee)
        fake_db = _FakeLeaveDB(scalar_values=[device, None])

        payload = EmployeeLeaveRequestCreate(
            device_fingerprint="employee-device-123",
            start_date=date(2026, 4, 10),
            end_date=date(2026, 4, 11),
            type=LeaveType.ANNUAL,
            note=" Aile isi ",
        )

        with patch("app.services.leaves.send_push_to_admins", return_value={"total_targets": 0}) as push_mock:
            leave = create_employee_leave_request(fake_db, payload)  # type: ignore[arg-type]

        self.assertEqual(leave.employee_id, employee.id)
        self.assertEqual(leave.status, LeaveStatus.PENDING)
        self.assertTrue(leave.requested_by_employee)
        self.assertEqual(leave.note, "Aile isi")
        self.assertEqual(fake_db.commit_count, 1)
        self.assertEqual(len(fake_db.added), 1)
        push_mock.assert_called_once()

    def test_employee_leave_request_rejects_overlapping_pending_or_approved_leave(self) -> None:
        employee = _build_employee()
        device = _build_device(employee)
        overlapping_leave = Leave(
            id=88,
            employee_id=employee.id,
            start_date=date(2026, 4, 10),
            end_date=date(2026, 4, 12),
            type=LeaveType.ANNUAL,
            status=LeaveStatus.APPROVED,
        )
        fake_db = _FakeLeaveDB(scalar_values=[device, overlapping_leave])

        payload = EmployeeLeaveRequestCreate(
            device_fingerprint="employee-device-123",
            start_date=date(2026, 4, 11),
            end_date=date(2026, 4, 13),
            type=LeaveType.SICK,
            note="Doktor kontrolu",
        )

        with patch("app.services.leaves.send_push_to_admins", return_value={"total_targets": 0}) as push_mock:
            with self.assertRaises(HTTPException) as exc:
                create_employee_leave_request(fake_db, payload)  # type: ignore[arg-type]

        self.assertEqual(exc.exception.status_code, 409)
        push_mock.assert_not_called()

    def test_decide_leave_updates_status_and_notifies_employee(self) -> None:
        employee = _build_employee()
        leave = Leave(
            id=55,
            employee_id=employee.id,
            start_date=date(2026, 4, 15),
            end_date=date(2026, 4, 16),
            type=LeaveType.EXCUSE,
            status=LeaveStatus.PENDING,
            requested_by_employee=True,
            note="Acil aile durumu",
        )
        leave.employee = employee
        fake_db = _FakeLeaveDB(
            scalar_values=[None],
            get_map={(Leave, 55): leave},
        )

        payload = LeaveDecisionRequest(
            status=LeaveStatus.APPROVED,
            decision_note="Onaylandi",
        )

        with patch("app.services.leaves.send_push_to_employees", return_value={"total_targets": 1}) as push_mock:
            decided = decide_leave(fake_db, leave_id=55, payload=payload)  # type: ignore[arg-type]

        self.assertEqual(decided.status, LeaveStatus.APPROVED)
        self.assertEqual(decided.decision_note, "Onaylandi")
        self.assertIsNotNone(decided.decided_at)
        self.assertEqual(fake_db.commit_count, 1)
        push_mock.assert_called_once()

    def test_rejected_leave_requires_decision_note(self) -> None:
        with self.assertRaises(ValidationError):
            LeaveDecisionRequest(status=LeaveStatus.REJECTED)


if __name__ == "__main__":
    unittest.main()
