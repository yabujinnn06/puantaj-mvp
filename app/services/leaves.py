from __future__ import annotations

from dataclasses import dataclass
from calendar import monthrange
from datetime import date, datetime, timezone
import logging
from pathlib import Path
import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import AdminUser, Device, Employee, Leave, LeaveAttachment, LeaveMessage, LeaveStatus, LeaveType
from app.schemas import (
    AdminLeaveMessageCreateRequest,
    EmployeeLeaveRequestCreate,
    EmployeeLeaveMessageCreateRequest,
    LeaveCreateRequest,
    LeaveDecisionRequest,
)
from app.services.push_notifications import send_push_to_admins, send_push_to_employees

logger = logging.getLogger("app.leaves")
_MAX_LEAVE_ATTACHMENT_BYTES = 8 * 1024 * 1024
_ALLOWED_LEAVE_ATTACHMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

_LEAVE_TYPE_LABELS: dict[LeaveType, str] = {
    LeaveType.ANNUAL: "yillik izin",
    LeaveType.SICK: "rapor",
    LeaveType.UNPAID: "ucretsiz izin",
    LeaveType.EXCUSE: "mazeret izni",
    LeaveType.PUBLIC_HOLIDAY: "resmi tatil",
}


@dataclass(slots=True)
class LeaveAttachmentPayload:
    file_name: str
    content_type: str
    file_size_bytes: int
    file_data: bytes


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _validate_leave_range(*, start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be greater than or equal to start_date",
        )


def _leave_type_label(value: LeaveType) -> str:
    return _LEAVE_TYPE_LABELS.get(value, value.value.lower())


def _trimmed_text(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _sanitize_attachment_filename(raw_name: str | None) -> str:
    candidate = Path((raw_name or "").strip()).name
    candidate = re.sub(r"[^A-Za-z0-9._ -]", "_", candidate).strip(" .")
    return (candidate or "belge")[:255]


def _validate_attachment_payload(payload: LeaveAttachmentPayload | None) -> LeaveAttachmentPayload | None:
    if payload is None:
        return None

    file_name = _sanitize_attachment_filename(payload.file_name)
    content_type = (payload.content_type or "").strip().lower()
    file_data = payload.file_data or b""
    file_size_bytes = int(payload.file_size_bytes or len(file_data))
    if not file_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment filename is required.")
    if content_type not in _ALLOWED_LEAVE_ATTACHMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported attachment type.",
        )
    if file_size_bytes <= 0 or not file_data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment is empty.")
    if file_size_bytes > _MAX_LEAVE_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Attachment exceeds the maximum allowed size.",
        )
    return LeaveAttachmentPayload(
        file_name=file_name,
        content_type=content_type,
        file_size_bytes=file_size_bytes,
        file_data=file_data,
    )


def _get_employee_or_404(db: Session, *, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def _get_active_employee_by_device(db: Session, *, device_fingerprint: str) -> tuple[Employee, Device]:
    device = db.scalar(
        select(Device).where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not claimed")

    employee = device.employee or db.get(Employee, device.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive employee cannot request leave",
        )
    return employee, device


def _find_overlapping_leave(
    db: Session,
    *,
    employee_id: int,
    start_date: date,
    end_date: date,
    exclude_leave_id: int | None = None,
) -> Leave | None:
    stmt = select(Leave).where(
        Leave.employee_id == employee_id,
        Leave.start_date <= end_date,
        Leave.end_date >= start_date,
        Leave.status.in_([LeaveStatus.PENDING, LeaveStatus.APPROVED]),
    )
    if exclude_leave_id is not None:
        stmt = stmt.where(Leave.id != exclude_leave_id)
    return db.scalar(stmt)


def _leave_thread_load_options():  # type: ignore[no-untyped-def]
    return (
        selectinload(Leave.employee),
        selectinload(Leave.leave_messages).selectinload(LeaveMessage.employee),
        selectinload(Leave.leave_messages).selectinload(LeaveMessage.sender_admin_user),
        selectinload(Leave.leave_attachments).selectinload(LeaveAttachment.uploaded_by_admin_user),
    )


def _leave_with_thread_or_404(db: Session, *, leave_id: int) -> Leave:
    stmt = select(Leave).options(*_leave_thread_load_options()).where(Leave.id == leave_id)
    leave = db.scalar(stmt)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")
    return leave


def _notify_admins_about_leave_request(
    db: Session,
    *,
    leave: Leave,
    employee: Employee,
    question: str | None = None,
    has_attachment: bool = False,
) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    type_label = _leave_type_label(leave.type)
    body = f"{employee.full_name} {start_text} - {end_text} tarihleri icin {type_label} talebi gonderdi."
    if question:
        body = f"{body} Soru: {question[:120]}"
    elif has_attachment:
        body = f"{body} Talebe belge eklendi."
    try:
        send_push_to_admins(
            db,
            title="Yeni izin talebi",
            body=body,
            data={
                "type": "LEAVE_REQUEST",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "url": f"/admin-panel/leaves?leave_id={leave.id}&thread=1",
            },
        )
    except Exception:
        logger.exception("leave_request_admin_push_failed", extra={"leave_id": leave.id, "employee_id": employee.id})


def _notify_employee_about_leave_decision(db: Session, *, leave: Leave, employee: Employee) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    type_label = _leave_type_label(leave.type)
    if leave.status == LeaveStatus.APPROVED:
        title = "Izin talebin onaylandi"
        body = f"{start_text} - {end_text} tarihleri icin {type_label} talebin onaylandi."
    else:
        title = "Izin talebin reddedildi"
        reason = _trimmed_text(leave.decision_note)
        reason_text = f" Sebep: {reason}." if reason else ""
        body = f"{start_text} - {end_text} tarihleri icin {type_label} talebin reddedildi.{reason_text}"

    try:
        send_push_to_employees(
            db,
            employee_ids=[employee.id],
            title=title,
            body=body,
            data={
                "type": "LEAVE_DECISION",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "status": leave.status.value,
                "url": "/employee/",
            },
        )
    except Exception:
        logger.exception(
            "leave_decision_employee_push_failed",
            extra={"leave_id": leave.id, "employee_id": employee.id, "status": leave.status.value},
        )


def _notify_admins_about_leave_message(db: Session, *, leave: Leave, employee: Employee, message: str) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    try:
        send_push_to_admins(
            db,
            title="Çalışandan yeni izin mesajı",
            body=f"{employee.full_name} {start_text} - {end_text} talebi için mesaj gönderdi: {message[:120]}",
            data={
                "type": "LEAVE_THREAD_MESSAGE",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "url": f"/admin-panel/leaves?leave_id={leave.id}&thread=1",
            },
        )
    except Exception:
        logger.exception(
            "leave_thread_admin_push_failed",
            extra={"leave_id": leave.id, "employee_id": employee.id},
        )


def _notify_employee_about_leave_message(db: Session, *, leave: Leave, employee: Employee, message: str) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    try:
        send_push_to_employees(
            db,
            employee_ids=[employee.id],
            title="İzin talebine yanıt geldi",
            body=f"{start_text} - {end_text} talebin için yeni mesaj var: {message[:120]}",
            data={
                "type": "LEAVE_THREAD_REPLY",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "url": f"/employee/?leave_id={leave.id}&thread=1",
            },
        )
    except Exception:
        logger.exception(
            "leave_thread_employee_push_failed",
            extra={"leave_id": leave.id, "employee_id": employee.id},
        )


def _create_leave_message(
    db: Session,
    *,
    leave: Leave,
    employee: Employee,
    sender_actor: str,
    message: str,
    sender_admin_user_id: int | None = None,
) -> LeaveMessage:
    normalized_message = _trimmed_text(message)
    if normalized_message is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Message is required.")
    row = LeaveMessage(
        leave_id=leave.id,
        employee_id=employee.id,
        sender_actor=sender_actor,
        sender_admin_user_id=sender_admin_user_id,
        message=normalized_message,
    )
    db.add(row)
    return row


def _create_leave_attachment(
    db: Session,
    *,
    leave: Leave,
    employee: Employee,
    attachment: LeaveAttachmentPayload,
    uploaded_by_actor: str = "EMPLOYEE",
    uploaded_by_admin_user_id: int | None = None,
) -> LeaveAttachment:
    row = LeaveAttachment(
        leave_id=leave.id,
        employee_id=employee.id,
        uploaded_by_actor=uploaded_by_actor,
        uploaded_by_admin_user_id=uploaded_by_admin_user_id,
        file_name=attachment.file_name,
        content_type=attachment.content_type,
        file_size_bytes=attachment.file_size_bytes,
        file_data=attachment.file_data,
    )
    db.add(row)
    return row


def create_leave(db: Session, payload: LeaveCreateRequest) -> Leave:
    _get_employee_or_404(db, employee_id=payload.employee_id)
    _validate_leave_range(start_date=payload.start_date, end_date=payload.end_date)

    leave = Leave(
        employee_id=payload.employee_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        type=payload.type,
        status=payload.status,
        note=_trimmed_text(payload.note),
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave


def list_leaves(
    db: Session,
    *,
    employee_id: int | None,
    year: int | None,
    month: int | None,
    status_filter: LeaveStatus | None = None,
    requested_by_employee: bool | None = None,
) -> list[Leave]:
    if (year is None) != (month is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="year and month must be provided together",
        )

    stmt = select(Leave).options(*_leave_thread_load_options()).order_by(Leave.start_date.asc(), Leave.id.asc())
    if employee_id is not None:
        stmt = stmt.where(Leave.employee_id == employee_id)
    if status_filter is not None:
        stmt = stmt.where(Leave.status == status_filter)
    if requested_by_employee is not None:
        stmt = stmt.where(Leave.requested_by_employee.is_(requested_by_employee))

    if year is not None and month is not None:
        days_in_month = monthrange(year, month)[1]
        start = date(year, month, 1)
        end = date(year, month, days_in_month)
        stmt = stmt.where(
            Leave.start_date <= end,
            Leave.end_date >= start,
        )

    return list(db.scalars(stmt).all())


def create_employee_leave_request(
    db: Session,
    payload: EmployeeLeaveRequestCreate,
    *,
    attachment: LeaveAttachmentPayload | None = None,
) -> Leave:
    _validate_leave_range(start_date=payload.start_date, end_date=payload.end_date)
    employee, _device = _get_active_employee_by_device(
        db,
        device_fingerprint=payload.device_fingerprint,
    )
    validated_attachment = _validate_attachment_payload(attachment)
    overlapping_leave = _find_overlapping_leave(
        db,
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if overlapping_leave is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is already an overlapping approved or pending leave for this employee.",
        )

    leave = Leave(
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        type=payload.type,
        status=LeaveStatus.PENDING,
        note=_trimmed_text(payload.note),
        requested_by_employee=True,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)

    if validated_attachment is not None or payload.question:
        if validated_attachment is not None:
            _create_leave_attachment(
                db,
                leave=leave,
                employee=employee,
                attachment=validated_attachment,
            )
        if payload.question:
            _create_leave_message(
                db,
                leave=leave,
                employee=employee,
                sender_actor="EMPLOYEE",
                message=payload.question,
            )
        db.commit()

    leave = _leave_with_thread_or_404(db, leave_id=leave.id)
    _notify_admins_about_leave_request(
        db,
        leave=leave,
        employee=employee,
        question=payload.question,
        has_attachment=validated_attachment is not None,
    )
    return leave


def decide_leave(
    db: Session,
    *,
    leave_id: int,
    payload: LeaveDecisionRequest,
) -> Leave:
    leave = db.get(Leave, leave_id)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")

    _validate_leave_range(start_date=leave.start_date, end_date=leave.end_date)
    if payload.status == LeaveStatus.APPROVED:
        overlapping_leave = _find_overlapping_leave(
            db,
            employee_id=leave.employee_id,
            start_date=leave.start_date,
            end_date=leave.end_date,
            exclude_leave_id=leave.id,
        )
        if overlapping_leave is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This leave overlaps with another approved or pending leave.",
            )

    leave.status = payload.status
    leave.decision_note = _trimmed_text(payload.decision_note)
    leave.decided_at = _utcnow()
    db.commit()
    db.refresh(leave)

    employee = leave.employee or _get_employee_or_404(db, employee_id=leave.employee_id)
    _notify_employee_about_leave_decision(db, leave=leave, employee=employee)
    return leave


def delete_leave(db: Session, leave_id: int) -> None:
    leave = db.get(Leave, leave_id)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")

    db.delete(leave)
    db.commit()


def get_leave_thread_for_employee(
    db: Session,
    *,
    leave_id: int,
    device_fingerprint: str,
) -> Leave:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=device_fingerprint)
    leave = _leave_with_thread_or_404(db, leave_id=leave_id)
    if leave.employee_id != employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this leave thread.")
    return leave


def get_leave_thread_for_admin(db: Session, *, leave_id: int) -> Leave:
    return _leave_with_thread_or_404(db, leave_id=leave_id)


def create_employee_leave_message(
    db: Session,
    *,
    leave_id: int,
    payload: EmployeeLeaveMessageCreateRequest,
) -> Leave:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=payload.device_fingerprint)
    leave = _leave_with_thread_or_404(db, leave_id=leave_id)
    if leave.employee_id != employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot message this leave thread.")
    _create_leave_message(
        db,
        leave=leave,
        employee=employee,
        sender_actor="EMPLOYEE",
        message=payload.message,
    )
    db.commit()
    leave = _leave_with_thread_or_404(db, leave_id=leave_id)
    _notify_admins_about_leave_message(db, leave=leave, employee=employee, message=payload.message)
    return leave


def create_admin_leave_message(
    db: Session,
    *,
    leave_id: int,
    payload: AdminLeaveMessageCreateRequest,
    admin_username: str,
    admin_user_id: int | None,
) -> Leave:
    leave = _leave_with_thread_or_404(db, leave_id=leave_id)
    employee = leave.employee or _get_employee_or_404(db, employee_id=leave.employee_id)
    if not employee.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive employee cannot receive replies.")

    sender_admin: AdminUser | None = None
    if admin_user_id is not None:
        sender_admin = db.get(AdminUser, admin_user_id)

    _create_leave_message(
        db,
        leave=leave,
        employee=employee,
        sender_actor="ADMIN",
        sender_admin_user_id=sender_admin.id if sender_admin is not None else admin_user_id,
        message=payload.message,
    )
    db.commit()
    leave = _leave_with_thread_or_404(db, leave_id=leave_id)
    _notify_employee_about_leave_message(db, leave=leave, employee=employee, message=payload.message)
    return leave


def get_leave_attachment_for_employee(
    db: Session,
    *,
    leave_id: int,
    attachment_id: int,
    device_fingerprint: str,
) -> LeaveAttachment:
    employee, _device = _get_active_employee_by_device(db, device_fingerprint=device_fingerprint)
    attachment = db.get(LeaveAttachment, attachment_id)
    if attachment is None or attachment.leave_id != leave_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave attachment not found")
    if attachment.employee_id != employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this attachment.")
    return attachment


def get_leave_attachment_for_admin(
    db: Session,
    *,
    leave_id: int,
    attachment_id: int,
) -> LeaveAttachment:
    attachment = db.get(LeaveAttachment, attachment_id)
    if attachment is None or attachment.leave_id != leave_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave attachment not found")
    return attachment
