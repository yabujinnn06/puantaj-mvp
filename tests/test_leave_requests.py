from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.models import AdminUser, Device, Employee, Leave, LeaveAttachment, LeaveMessage, LeaveStatus, LeaveType
from app.schemas import AdminLeaveMessageCreateRequest, EmployeeLeaveRequestCreate, LeaveDecisionRequest
from app.services.leaves import LeaveAttachmentPayload, create_admin_leave_message, create_employee_leave_request, decide_leave


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
        if self._scalar_values:
            return self._scalar_values.pop(0)
        for row in reversed(self.added):
            if isinstance(row, Leave):
                if row.leave_attachments is None:
                    row.leave_attachments = []
                if row.leave_messages is None:
                    row.leave_messages = []
                return row
        return None

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))

    def add(self, obj: object) -> None:
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            setattr(obj, "id", self._next_id)
            self._next_id += 1
        self.added.append(obj)
        if isinstance(obj, LeaveAttachment):
            for row in reversed(self.added):
                if isinstance(row, Leave) and row.id == obj.leave_id:
                    attachments = list(row.leave_attachments or [])
                    attachments.append(obj)
                    row.leave_attachments = attachments
                    break
        if isinstance(obj, LeaveMessage):
            for row in reversed(self.added):
                if isinstance(row, Leave) and row.id == obj.leave_id:
                    messages = list(row.leave_messages or [])
                    messages.append(obj)
                    row.leave_messages = messages
                    break

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

    def test_employee_leave_request_can_include_attachment_and_question(self) -> None:
        employee = _build_employee()
        device = _build_device(employee)
        fake_db = _FakeLeaveDB(scalar_values=[device, None])

        payload = EmployeeLeaveRequestCreate(
            device_fingerprint="employee-device-123",
            start_date=date(2026, 4, 20),
            end_date=date(2026, 4, 21),
            type=LeaveType.SICK,
            note="Doktor kontrolü",
            question="Raporu sisteme ekledim, başka bir işlem gerekiyor mu?",
        )
        attachment = LeaveAttachmentPayload(
            file_name="rapor.pdf",
            content_type="application/pdf",
            file_data=b"fake-pdf",
            file_size_bytes=8,
        )

        with patch("app.services.leaves.send_push_to_admins", return_value={"total_targets": 1}) as push_mock:
            leave = create_employee_leave_request(fake_db, payload, attachment=attachment)  # type: ignore[arg-type]

        attachment_rows = [row for row in fake_db.added if isinstance(row, LeaveAttachment)]
        message_rows = [row for row in fake_db.added if isinstance(row, LeaveMessage)]

        self.assertEqual(leave.status, LeaveStatus.PENDING)
        self.assertEqual(len(attachment_rows), 1)
        self.assertEqual(len(message_rows), 1)
        self.assertEqual(attachment_rows[0].file_name, "rapor.pdf")
        self.assertEqual(message_rows[0].message, payload.question)
        self.assertEqual(fake_db.commit_count, 2)
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

    def test_admin_leave_message_notifies_employee(self) -> None:
        employee = _build_employee()
        leave = Leave(
          id=77,
          employee_id=employee.id,
          start_date=date(2026, 4, 22),
          end_date=date(2026, 4, 23),
          type=LeaveType.EXCUSE,
          status=LeaveStatus.PENDING,
          requested_by_employee=True,
          note="Kısa aile işi",
        )
        leave.employee = employee
        admin_user = AdminUser(id=3, username="admin.portal", is_active=True)
        fake_db = _FakeLeaveDB(
            scalar_values=[leave, leave],
            get_map={(AdminUser, 3): admin_user},
        )

        payload = AdminLeaveMessageCreateRequest(message="Belge ulaştı, bugün içinde değerlendiriyoruz.")

        with patch("app.services.leaves.send_push_to_employees", return_value={"total_targets": 1}) as push_mock:
            updated_leave = create_admin_leave_message(
                fake_db,
                leave_id=77,
                payload=payload,
                admin_username="admin.portal",
                admin_user_id=3,
            )  # type: ignore[arg-type]

        message_rows = [row for row in fake_db.added if isinstance(row, LeaveMessage)]

        self.assertEqual(updated_leave.id, leave.id)
        self.assertEqual(len(message_rows), 1)
        self.assertEqual(message_rows[0].sender_actor, "ADMIN")
        self.assertEqual(message_rows[0].sender_admin_user_id, 3)
        self.assertEqual(message_rows[0].message, payload.message)
        self.assertEqual(fake_db.commit_count, 1)
        push_mock.assert_called_once()

    def test_rejected_leave_requires_decision_note(self) -> None:
        with self.assertRaises(ValidationError):
            LeaveDecisionRequest(status=LeaveStatus.REJECTED)


if __name__ == "__main__":
    unittest.main()
