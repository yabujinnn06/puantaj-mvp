from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.models import (
    AdminUser,
    Device,
    Employee,
    EmployeeConversation,
    EmployeeConversationCategory,
    EmployeeConversationMessage,
    EmployeeConversationStatus,
)
from app.schemas import (
    AdminConversationMessageCreateRequest,
    EmployeeConversationCreateRequest,
    EmployeeConversationMessageCreateRequest,
)
from app.services.communications import (
    clear_admin_conversation_messages,
    create_admin_conversation_message,
    create_employee_conversation,
    create_employee_conversation_message,
    update_admin_conversation_status,
)


class _ScalarResult:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return list(self._rows)


class _FakeCommunicationDB:
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
        self._next_id = 2000

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if self._scalar_values:
            return self._scalar_values.pop(0)
        for row in reversed(self.added):
            if isinstance(row, EmployeeConversation):
                if row.messages is None:
                    row.messages = []
                if row.employee is None:
                    employee = self._get_map.get((Employee, row.employee_id))
                    if isinstance(employee, Employee):
                        row.employee = employee
                return row
        return None

    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        rows = [
            row
            for row in self.added
            if isinstance(row, EmployeeConversation)
        ]
        return _ScalarResult(rows)

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        return self._get_map.get((model, pk))

    def add(self, obj: object) -> None:
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            setattr(obj, "id", self._next_id)
            self._next_id += 1

        if isinstance(obj, EmployeeConversation):
            if obj.messages is None:
                obj.messages = []
            employee = self._get_map.get((Employee, obj.employee_id))
            if isinstance(employee, Employee):
                obj.employee = employee

        if isinstance(obj, EmployeeConversationMessage):
            employee = self._get_map.get((Employee, obj.employee_id))
            if isinstance(employee, Employee):
                obj.employee = employee
            if obj.sender_admin_user_id is not None:
                admin_user = self._get_map.get((AdminUser, obj.sender_admin_user_id))
                if isinstance(admin_user, AdminUser):
                    obj.sender_admin_user = admin_user
            for row in reversed(self.added):
                if isinstance(row, EmployeeConversation) and row.id == obj.conversation_id:
                    messages = list(row.messages or [])
                    messages.append(obj)
                    row.messages = messages
                    break

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


def _build_conversation(employee: Employee) -> EmployeeConversation:
    conversation = EmployeeConversation(
        id=81,
        employee_id=employee.id,
        category=EmployeeConversationCategory.ATTENDANCE,
        subject="Nisan vardiya planı hakkında bilgi",
        status=EmployeeConversationStatus.OPEN,
    )
    conversation.employee = employee
    conversation.messages = []
    return conversation


class EmployeeCommunicationsServiceTests(unittest.TestCase):
    def test_employee_conversation_creates_thread_and_notifies_admins(self) -> None:
        employee = _build_employee()
        device = _build_device(employee)
        fake_db = _FakeCommunicationDB(
            scalar_values=[device],
            get_map={(Employee, employee.id): employee},
        )

        payload = EmployeeConversationCreateRequest(
            device_fingerprint="employee-device-123",
            category=EmployeeConversationCategory.SHIFT,
            subject=" 12 Nisan vardiya düzeni ",
            message="12 Nisan 2026 vardiya planım hakkında bilgi rica ediyorum.",
        )

        with patch("app.services.communications.send_push_to_admins", return_value={"total_targets": 0}) as push_mock:
            conversation = create_employee_conversation(fake_db, payload)  # type: ignore[arg-type]

        message_rows = [row for row in fake_db.added if isinstance(row, EmployeeConversationMessage)]

        self.assertEqual(conversation.employee_id, employee.id)
        self.assertEqual(conversation.category, EmployeeConversationCategory.SHIFT)
        self.assertEqual(conversation.status, EmployeeConversationStatus.OPEN)
        self.assertEqual(conversation.message_count, 1)
        self.assertEqual(len(message_rows), 1)
        self.assertEqual(message_rows[0].sender_actor, "EMPLOYEE")
        self.assertEqual(message_rows[0].message, payload.message)
        self.assertEqual(fake_db.commit_count, 2)
        push_mock.assert_called_once()

    def test_employee_conversation_message_rejects_casual_language(self) -> None:
        with self.assertRaises(ValidationError):
            EmployeeConversationMessageCreateRequest(
                device_fingerprint="employee-device-123",
                message="slm knk bana bir bakar misin",
            )

    def test_admin_reply_notifies_employee(self) -> None:
        employee = _build_employee()
        conversation = _build_conversation(employee)
        admin_user = AdminUser(id=3, username="admin.portal", full_name="Portal Admin", is_active=True)
        fake_db = _FakeCommunicationDB(
            scalar_values=[conversation, conversation],
            get_map={
                (AdminUser, 3): admin_user,
                (Employee, employee.id): employee,
            },
        )

        payload = AdminConversationMessageCreateRequest(
            message="Talebiniz kayıt altına alınmıştır. Güncel durumu bugün içinde paylaşacağız.",
        )

        with patch("app.services.communications.send_push_to_employees", return_value={"total_targets": 1}) as push_mock:
            updated_conversation = create_admin_conversation_message(
                fake_db,
                conversation_id=conversation.id,
                payload=payload,
                admin_user_id=3,
            )  # type: ignore[arg-type]

        message_rows = [row for row in fake_db.added if isinstance(row, EmployeeConversationMessage)]

        self.assertEqual(updated_conversation.id, conversation.id)
        self.assertEqual(len(message_rows), 1)
        self.assertEqual(message_rows[0].sender_actor, "ADMIN")
        self.assertEqual(message_rows[0].sender_admin_user_id, 3)
        self.assertEqual(message_rows[0].message, payload.message)
        self.assertEqual(fake_db.commit_count, 1)
        push_mock.assert_called_once()

    def test_employee_reply_to_closed_conversation_returns_conflict(self) -> None:
        employee = _build_employee()
        device = _build_device(employee)
        conversation = _build_conversation(employee)
        conversation.status = EmployeeConversationStatus.CLOSED
        fake_db = _FakeCommunicationDB(
            scalar_values=[device, conversation],
            get_map={(Employee, employee.id): employee},
        )

        payload = EmployeeConversationMessageCreateRequest(
            device_fingerprint="employee-device-123",
            message="Talebimin mevcut durumu hakkında resmi bilgi rica ediyorum.",
        )

        with self.assertRaises(HTTPException) as exc:
            create_employee_conversation_message(  # type: ignore[arg-type]
                fake_db,
                conversation_id=conversation.id,
                payload=payload,
            )

        self.assertEqual(exc.exception.status_code, 409)

    def test_admin_can_close_conversation(self) -> None:
        employee = _build_employee()
        conversation = _build_conversation(employee)
        fake_db = _FakeCommunicationDB(scalar_values=[conversation, conversation])

        updated_conversation = update_admin_conversation_status(
            fake_db,  # type: ignore[arg-type]
            conversation_id=conversation.id,
            status_value=EmployeeConversationStatus.CLOSED,
        )

        self.assertEqual(updated_conversation.status, EmployeeConversationStatus.CLOSED)
        self.assertIsNotNone(updated_conversation.closed_at)
        self.assertEqual(fake_db.commit_count, 1)

    def test_admin_can_clear_conversation_messages(self) -> None:
        employee = _build_employee()
        conversation = _build_conversation(employee)
        conversation.messages = [
            EmployeeConversationMessage(
                id=901,
                conversation_id=conversation.id,
                employee_id=employee.id,
                sender_actor="EMPLOYEE",
                message="Talebimle ilgili güncel durumu öğrenmek istiyorum.",
            ),
            EmployeeConversationMessage(
                id=902,
                conversation_id=conversation.id,
                employee_id=employee.id,
                sender_actor="ADMIN",
                message="İnceleme tamamlandıktan sonra sizi bilgilendireceğiz.",
            ),
        ]
        fake_db = _FakeCommunicationDB(scalar_values=[conversation, conversation])

        cleared_conversation = clear_admin_conversation_messages(
            fake_db,  # type: ignore[arg-type]
            conversation_id=conversation.id,
        )

        self.assertEqual(cleared_conversation.id, conversation.id)
        self.assertEqual(cleared_conversation.message_count, 0)
        self.assertEqual(cleared_conversation.messages, [])
        self.assertEqual(fake_db.commit_count, 1)


if __name__ == "__main__":
    unittest.main()
