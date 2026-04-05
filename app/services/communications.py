from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

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
from app.services.push_notifications import send_push_to_admins, send_push_to_employees

logger = logging.getLogger("app.communications")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _category_label(category: EmployeeConversationCategory) -> str:
    if category == EmployeeConversationCategory.ATTENDANCE:
        return "Puantaj"
    if category == EmployeeConversationCategory.SHIFT:
        return "Vardiya"
    if category == EmployeeConversationCategory.DEVICE:
        return "Cihaz"
    if category == EmployeeConversationCategory.DOCUMENT:
        return "Belge"
    return "Genel"


def _conversation_load_options():  # type: ignore[no-untyped-def]
    return (
        selectinload(EmployeeConversation.employee),
        selectinload(EmployeeConversation.messages).selectinload(EmployeeConversationMessage.employee),
        selectinload(EmployeeConversation.messages).selectinload(EmployeeConversationMessage.sender_admin_user),
    )


def _get_active_employee_by_device(
    db: Session,
    *,
    device_fingerprint: str,
) -> tuple[Employee, Device]:
    stmt = (
        select(Device)
        .options(selectinload(Device.employee))
        .where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    device = db.scalar(stmt)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not claimed")

    employee = device.employee or db.get(Employee, device.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive employee cannot access this resource.",
        )
    return employee, device


def _conversation_with_thread_or_404(db: Session, *, conversation_id: int) -> EmployeeConversation:
    stmt = (
        select(EmployeeConversation)
        .options(*_conversation_load_options())
        .where(EmployeeConversation.id == conversation_id)
    )
    conversation = db.scalar(stmt)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


def _create_conversation_message(
    db: Session,
    *,
    conversation: EmployeeConversation,
    employee: Employee,
    sender_actor: str,
    message: str,
    sender_admin_user_id: int | None = None,
) -> EmployeeConversationMessage:
    row = EmployeeConversationMessage(
        conversation_id=conversation.id,
        employee_id=employee.id,
        sender_actor=sender_actor,
        sender_admin_user_id=sender_admin_user_id,
        message=message.strip(),
    )
    db.add(row)
    conversation.last_message_at = _utcnow()
    if conversation.status == EmployeeConversationStatus.CLOSED:
        conversation.status = EmployeeConversationStatus.OPEN
        conversation.closed_at = None
    return row


def _notify_admins_about_new_conversation(
    db: Session,
    *,
    conversation: EmployeeConversation,
    employee: Employee,
    message: str,
) -> None:
    category_label = _category_label(conversation.category)
    try:
        send_push_to_admins(
            db,
            title="Yeni kurumsal çalışan mesajı",
            body=f"{employee.full_name} {category_label} konusunda yazdı: {message[:120]}",
            data={
                "type": "EMPLOYEE_CONVERSATION_CREATED",
                "conversation_id": conversation.id,
                "employee_id": employee.id,
                "url": f"/admin-panel/communications?conversation_id={conversation.id}&thread=1",
            },
        )
    except Exception:
        logger.exception(
            "employee_conversation_admin_push_failed",
            extra={"conversation_id": conversation.id, "employee_id": employee.id},
        )


def _notify_admins_about_employee_reply(
    db: Session,
    *,
    conversation: EmployeeConversation,
    employee: Employee,
    message: str,
) -> None:
    category_label = _category_label(conversation.category)
    try:
        send_push_to_admins(
            db,
            title="Kurumsal yazışmaya yeni yanıt",
            body=f"{employee.full_name} {category_label} başlığında yanıt verdi: {message[:120]}",
            data={
                "type": "EMPLOYEE_CONVERSATION_REPLY",
                "conversation_id": conversation.id,
                "employee_id": employee.id,
                "url": f"/admin-panel/communications?conversation_id={conversation.id}&thread=1",
            },
        )
    except Exception:
        logger.exception(
            "employee_conversation_reply_admin_push_failed",
            extra={"conversation_id": conversation.id, "employee_id": employee.id},
        )


def _notify_employee_about_admin_reply(
    db: Session,
    *,
    conversation: EmployeeConversation,
    employee: Employee,
    message: str,
) -> None:
    try:
        send_push_to_employees(
            db,
            employee_ids=[employee.id],
            title="Yöneticiden kurumsal yanıt geldi",
            body=f"{conversation.subject} başlığın için yeni yanıt var: {message[:120]}",
            data={
                "type": "EMPLOYEE_CONVERSATION_ADMIN_REPLY",
                "conversation_id": conversation.id,
                "employee_id": employee.id,
                "url": f"/employee/?conversation_id={conversation.id}&communication=1",
            },
        )
    except Exception:
        logger.exception(
            "employee_conversation_employee_push_failed",
            extra={"conversation_id": conversation.id, "employee_id": employee.id},
        )


def list_employee_conversations(
    db: Session,
    *,
    device_fingerprint: str,
) -> list[EmployeeConversation]:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=device_fingerprint)
    stmt = (
        select(EmployeeConversation)
        .options(*_conversation_load_options())
        .where(EmployeeConversation.employee_id == employee.id)
        .order_by(EmployeeConversation.last_message_at.desc(), EmployeeConversation.id.desc())
    )
    return list(db.scalars(stmt).all())


def create_employee_conversation(
    db: Session,
    payload: EmployeeConversationCreateRequest,
) -> EmployeeConversation:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=payload.device_fingerprint)
    now = _utcnow()
    conversation = EmployeeConversation(
        employee_id=employee.id,
        category=payload.category,
        subject=payload.subject,
        status=EmployeeConversationStatus.OPEN,
        last_message_at=now,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    _create_conversation_message(
        db,
        conversation=conversation,
        employee=employee,
        sender_actor="EMPLOYEE",
        message=payload.message,
    )
    db.commit()

    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation.id)
    _notify_admins_about_new_conversation(
        db,
        conversation=conversation,
        employee=employee,
        message=payload.message,
    )
    return conversation


def get_employee_conversation_thread(
    db: Session,
    *,
    conversation_id: int,
    device_fingerprint: str,
) -> EmployeeConversation:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=device_fingerprint)
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    if conversation.employee_id != employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this conversation.")
    return conversation


def create_employee_conversation_message(
    db: Session,
    *,
    conversation_id: int,
    payload: EmployeeConversationMessageCreateRequest,
) -> EmployeeConversation:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=payload.device_fingerprint)
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    if conversation.employee_id != employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot message this conversation.")
    if conversation.status == EmployeeConversationStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conversation is closed.")
    _create_conversation_message(
        db,
        conversation=conversation,
        employee=employee,
        sender_actor="EMPLOYEE",
        message=payload.message,
    )
    db.commit()
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    _notify_admins_about_employee_reply(
        db,
        conversation=conversation,
        employee=employee,
        message=payload.message,
    )
    return conversation


def list_admin_conversations(
    db: Session,
    *,
    employee_id: int | None = None,
    status_filter: EmployeeConversationStatus | None = None,
) -> list[EmployeeConversation]:
    stmt = select(EmployeeConversation).options(*_conversation_load_options())
    if employee_id is not None:
        stmt = stmt.where(EmployeeConversation.employee_id == employee_id)
    if status_filter is not None:
        stmt = stmt.where(EmployeeConversation.status == status_filter)
    stmt = stmt.order_by(EmployeeConversation.last_message_at.desc(), EmployeeConversation.id.desc())
    return list(db.scalars(stmt).all())


def get_admin_conversation_thread(
    db: Session,
    *,
    conversation_id: int,
) -> EmployeeConversation:
    return _conversation_with_thread_or_404(db, conversation_id=conversation_id)


def create_admin_conversation_message(
    db: Session,
    *,
    conversation_id: int,
    payload: AdminConversationMessageCreateRequest,
    admin_user_id: int | None,
) -> EmployeeConversation:
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    employee = conversation.employee or db.get(Employee, conversation.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive employee cannot receive replies.")
    if conversation.status == EmployeeConversationStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conversation is closed.")

    sender_admin: AdminUser | None = db.get(AdminUser, admin_user_id) if admin_user_id is not None else None
    _create_conversation_message(
        db,
        conversation=conversation,
        employee=employee,
        sender_actor="ADMIN",
        sender_admin_user_id=sender_admin.id if sender_admin is not None else admin_user_id,
        message=payload.message,
    )
    db.commit()
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    _notify_employee_about_admin_reply(
        db,
        conversation=conversation,
        employee=employee,
        message=payload.message,
    )
    return conversation


def update_admin_conversation_status(
    db: Session,
    *,
    conversation_id: int,
    status_value: EmployeeConversationStatus,
) -> EmployeeConversation:
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    conversation.status = status_value
    conversation.closed_at = _utcnow() if status_value == EmployeeConversationStatus.CLOSED else None
    db.commit()
    return _conversation_with_thread_or_404(db, conversation_id=conversation_id)


def clear_admin_conversation_messages(
    db: Session,
    *,
    conversation_id: int,
) -> EmployeeConversation:
    conversation = _conversation_with_thread_or_404(db, conversation_id=conversation_id)
    if conversation.messages:
        conversation.messages = []
    conversation.last_message_at = conversation.created_at or _utcnow()
    db.commit()
    return _conversation_with_thread_or_404(db, conversation_id=conversation_id)
