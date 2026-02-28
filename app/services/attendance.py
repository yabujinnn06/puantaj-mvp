from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
import secrets
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import (
    AttendanceExtraCheckinApproval,
    AttendanceEvent,
    AttendanceEventSource,
    AttendanceType,
    DepartmentShift,
    Device,
    DevicePasskey,
    Employee,
    EmployeeLocation,
    QRCode,
    QRCodePoint,
    QRCodeType,
    QRPoint,
)
from app.schemas import AttendanceEventCreate
from app.settings import get_settings
from app.services.location import distance_m, evaluate_location
from app.services.push_notifications import send_push_to_admins
from app.services.schedule_plans import resolve_effective_plan_for_employee_day

QR_DOUBLE_SCAN_WINDOW = timedelta(minutes=5)
EXTRA_CHECKIN_APPROVAL_STATUS_PENDING = "PENDING"
EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED = "APPROVED"
EXTRA_CHECKIN_APPROVAL_STATUS_CONSUMED = "CONSUMED"
EXTRA_CHECKIN_APPROVAL_STATUS_EXPIRED = "EXPIRED"


def _normalize_ts(ts_utc: datetime | None) -> datetime:
    if ts_utc is None:
        return datetime.now(timezone.utc)

    if ts_utc.tzinfo is None:
        return ts_utc.replace(tzinfo=timezone.utc)

    return ts_utc.astimezone(timezone.utc)


def _normalize_local_or_utc(
    *,
    ts_utc: datetime | None,
    ts_local: datetime | None,
) -> datetime:
    if ts_utc is not None and ts_local is not None:
        raise ApiError(
            status_code=422,
            code="INVALID_TS_INPUT",
            message="ts_utc ve ts_local ayni anda gonderilemez.",
        )
    if ts_utc is not None:
        return _normalize_ts(ts_utc)
    if ts_local is not None:
        if ts_local.tzinfo is None:
            localized = ts_local.replace(tzinfo=_attendance_timezone())
            return localized.astimezone(timezone.utc)
        return ts_local.astimezone(timezone.utc)
    raise ApiError(
        status_code=422,
        code="MISSING_TS",
        message="ts_utc veya ts_local zorunludur.",
    )


@lru_cache
def _attendance_timezone() -> ZoneInfo:
    raw_name = (get_settings().attendance_timezone or "").strip() or "Europe/Istanbul"
    try:
        return ZoneInfo(raw_name)
    except Exception:
        return ZoneInfo("Europe/Istanbul")


def _local_day_bounds_utc(reference_ts_utc: datetime) -> tuple[datetime, datetime]:
    normalized = _normalize_ts(reference_ts_utc)
    tz = _attendance_timezone()
    local_day = normalized.astimezone(tz).date()
    local_start = datetime.combine(local_day, time.min, tzinfo=tz)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def _resolve_active_device(db: Session, device_fingerprint: str) -> Device:
    device = db.scalar(
        select(Device).where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Device must be claimed first.",
        )

    employee = device.employee
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Employee not found for this device.",
        )
    if not employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee cannot perform attendance actions.",
        )

    return device


class QRScanDeniedError(Exception):
    def __init__(
        self,
        *,
        reason: str,
        closest_distance_m: int | None,
        employee_id: int | None,
        code_id: int | None,
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.closest_distance_m = closest_distance_m
        self.employee_id = employee_id
        self.code_id = code_id


def _resolve_qr_code_by_value(
    db: Session,
    *,
    code_value: str,
) -> QRCode:
    normalized_code_value = code_value.strip()
    qr_code = db.scalar(
        select(QRCode).where(
            QRCode.code_value == normalized_code_value,
            QRCode.is_active.is_(True),
        )
    )
    if qr_code is None:
        raise ApiError(
            status_code=404,
            code="QR_CODE_NOT_FOUND",
            message="Active QR code not found.",
        )
    return qr_code


def _load_active_qr_points_for_code(db: Session, *, code_id: int) -> list[QRPoint]:
    mappings = list(
        db.scalars(
            select(QRCodePoint)
            .options(selectinload(QRCodePoint.qr_point))
            .where(QRCodePoint.qr_code_id == code_id)
        ).all()
    )
    active_points: list[QRPoint] = []
    for mapping in mappings:
        point = mapping.qr_point
        if point is None:
            continue
        if not point.is_active:
            continue
        active_points.append(point)
    return active_points


def _resolve_latest_event_for_employee(
    db: Session,
    *,
    employee_id: int,
    reference_ts_utc: datetime,
) -> AttendanceEvent | None:
    reference_ts = _normalize_ts(reference_ts_utc)
    return db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.ts_utc <= reference_ts,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )


def _resolve_recent_qr_scan_event(
    db: Session,
    *,
    employee_id: int,
    reference_ts_utc: datetime,
) -> AttendanceEvent | None:
    reference_ts = _normalize_ts(reference_ts_utc)
    window_start = reference_ts - QR_DOUBLE_SCAN_WINDOW
    recent_events = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee_id,
                AttendanceEvent.ts_utc >= window_start,
                AttendanceEvent.ts_utc <= reference_ts,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
        ).all()
    )
    for event in recent_events:
        flags = event.flags
        if isinstance(flags, dict) and isinstance(flags.get("qr"), dict):
            return event
    return None


def _shift_crosses_midnight(shift: DepartmentShift | None) -> bool:
    if shift is None:
        return False
    return shift.end_time_local <= shift.start_time_local


def _resolve_active_open_shift_event(
    db: Session,
    *,
    employee: Employee,
    reference_ts_utc: datetime,
) -> AttendanceEvent | None:
    reference_ts = _normalize_ts(reference_ts_utc)
    latest_event = _resolve_latest_event_for_employee(
        db,
        employee_id=employee.id,
        reference_ts_utc=reference_ts,
    )
    if latest_event is None or latest_event.type != AttendanceType.IN:
        return None

    latest_local_day = _local_day_from_utc(latest_event.ts_utc)
    reference_local_day = _local_day_from_utc(reference_ts)
    if latest_local_day == reference_local_day:
        return latest_event

    inherited_shift = _resolve_shift_from_last_checkin(
        db,
        employee=employee,
        reference_ts_utc=reference_ts,
    )
    if not _shift_crosses_midnight(inherited_shift):
        return None

    if reference_local_day == latest_local_day + timedelta(days=1):
        return latest_event

    return None


def _resolve_qr_scan_event_type(
    db: Session,
    *,
    employee: Employee,
    code_type: QRCodeType,
) -> AttendanceType:
    if code_type == QRCodeType.CHECKIN:
        return AttendanceType.IN
    if code_type == QRCodeType.CHECKOUT:
        return AttendanceType.OUT

    active_open_event = _resolve_active_open_shift_event(
        db,
        employee=employee,
        reference_ts_utc=datetime.now(timezone.utc),
    )
    if active_open_event is not None:
        return AttendanceType.OUT
    return AttendanceType.IN


def create_employee_qr_scan_event(
    db: Session,
    *,
    device_fingerprint: str,
    code_value: str,
    lat: float,
    lon: float,
    accuracy_m: float | None,
) -> AttendanceEvent:
    device = _resolve_active_device(db, device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Employee not found for this device.",
        )
    now_utc = datetime.now(timezone.utc)
    recent_qr_event = _resolve_recent_qr_scan_event(
        db,
        employee_id=employee.id,
        reference_ts_utc=now_utc,
    )
    if recent_qr_event is not None:
        retry_after_seconds = int(
            max(0, (recent_qr_event.ts_utc + QR_DOUBLE_SCAN_WINDOW - now_utc).total_seconds())
        )
        message = "Ayni calisan icin QR okutmalar arasinda en az 5 dakika olmalidir."
        if retry_after_seconds > 0:
            message = f"{message} Kalan sure: {retry_after_seconds} sn."
        raise ApiError(
            status_code=409,
            code="QR_DOUBLE_SCAN_BLOCKED",
            message=message,
        )

    qr_code = _resolve_qr_code_by_value(db, code_value=code_value)
    active_points = _load_active_qr_points_for_code(db, code_id=qr_code.id)
    if not active_points:
        raise ApiError(
            status_code=422,
            code="QR_CODE_HAS_NO_ACTIVE_POINTS",
            message="QR code has no active location points.",
        )

    closest_distance: float | None = None
    matched_point: QRPoint | None = None
    matched_distance: float | None = None

    for point in active_points:
        point_distance_m = distance_m(lat, lon, point.lat, point.lon)

        if closest_distance is None or point_distance_m < closest_distance:
            closest_distance = point_distance_m

        if point_distance_m <= float(point.radius_m):
            if matched_distance is None or point_distance_m < matched_distance:
                matched_distance = point_distance_m
                matched_point = point

    if matched_point is None or matched_distance is None:
        raise QRScanDeniedError(
            reason="QR_POINT_OUT_OF_RANGE",
            closest_distance_m=(int(round(closest_distance)) if closest_distance is not None else None),
            employee_id=employee.id,
            code_id=qr_code.id if qr_code is not None else None,
        )

    event_type = _resolve_qr_scan_event_type(
        db,
        employee=employee,
        code_type=qr_code.code_type,
    )
    qr_flags = {
        "qr": {
            "code_id": qr_code.id,
            "matched_point_id": matched_point.id,
            "distance_m": int(round(matched_distance)),
            "radius_m": int(matched_point.radius_m),
            "accuracy_m": accuracy_m,
        }
    }

    return _build_attendance_event(
        db,
        device_fingerprint=device_fingerprint,
        event_type=event_type,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        extra_flags=qr_flags,
    )


def _validate_and_resolve_shift(
    db: Session,
    *,
    employee: Employee,
    shift_id: int | None,
) -> DepartmentShift | None:
    if shift_id is None:
        return None
    shift = db.get(DepartmentShift, shift_id)
    if shift is None:
        raise ApiError(
            status_code=404,
            code="SHIFT_NOT_FOUND",
            message="Shift not found.",
        )
    if employee.department_id is None or shift.department_id != employee.department_id:
        raise ApiError(
            status_code=422,
            code="SHIFT_DEPARTMENT_MISMATCH",
            message="Shift does not belong to employee department.",
        )
    if not shift.is_active:
        raise ApiError(
            status_code=422,
            code="SHIFT_INACTIVE",
            message="Shift is inactive.",
        )
    return shift


def _minutes_of_day(value: time) -> int:
    return value.hour * 60 + value.minute


def _circular_minutes_diff(a: int, b: int) -> int:
    raw = abs(a - b)
    return min(raw, 1440 - raw)


def _extract_shift_id_from_flags(flags: dict[str, Any] | None) -> int | None:
    if not flags:
        return None
    raw = flags.get("SHIFT_ID")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isdigit():
        return int(raw)
    return None


def _resolve_fallback_shift(
    db: Session,
    *,
    employee: Employee,
    shift_id: int | None,
) -> DepartmentShift | None:
    if shift_id is None:
        return None
    try:
        return _validate_and_resolve_shift(db, employee=employee, shift_id=shift_id)
    except ApiError:
        return None


def _resolve_shift_from_last_checkin(
    db: Session,
    *,
    employee: Employee,
    reference_ts_utc: datetime,
) -> DepartmentShift | None:
    last_event = _resolve_latest_event_for_employee(
        db,
        employee_id=employee.id,
        reference_ts_utc=reference_ts_utc,
    )
    if last_event is None or last_event.type != AttendanceType.IN:
        return None
    shift_id = _extract_shift_id_from_flags(last_event.flags)
    return _resolve_fallback_shift(db, employee=employee, shift_id=shift_id)


def _infer_shift_from_checkin_time(
    db: Session,
    *,
    employee: Employee,
    checkin_ts_utc: datetime,
) -> tuple[DepartmentShift | None, int | None]:
    if employee.department_id is None:
        return None, None

    shifts = list(
        db.scalars(
            select(DepartmentShift)
            .where(
                DepartmentShift.department_id == employee.department_id,
                DepartmentShift.is_active.is_(True),
            )
            .order_by(DepartmentShift.id.asc())
        ).all()
    )
    if not shifts:
        return None, None

    local_time = _normalize_ts(checkin_ts_utc).astimezone(_attendance_timezone()).time()
    local_minutes = _minutes_of_day(local_time)
    best_shift: DepartmentShift | None = None
    best_diff: int | None = None

    for shift in shifts:
        shift_start_minutes = _minutes_of_day(shift.start_time_local)
        diff = _circular_minutes_diff(local_minutes, shift_start_minutes)
        if best_shift is None or best_diff is None or diff < best_diff:
            best_shift = shift
            best_diff = diff

    return best_shift, best_diff


def _duplicate_event_id(
    db: Session,
    employee_id: int,
    event_type: AttendanceType,
    ts_utc: datetime,
    exclude_event_id: int | None = None,
) -> int | None:
    day_start, day_end = _local_day_bounds_utc(ts_utc)
    prev_stmt = (
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.ts_utc >= day_start,
            AttendanceEvent.ts_utc < day_end,
            AttendanceEvent.ts_utc <= ts_utc,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )
    next_stmt = (
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.ts_utc >= day_start,
            AttendanceEvent.ts_utc < day_end,
            AttendanceEvent.ts_utc >= ts_utc,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )
    if exclude_event_id is not None:
        prev_stmt = prev_stmt.where(AttendanceEvent.id != exclude_event_id)
        next_stmt = next_stmt.where(AttendanceEvent.id != exclude_event_id)

    prev_event = db.scalar(prev_stmt)
    if prev_event is not None and prev_event.type == event_type:
        return prev_event.id

    next_event = db.scalar(next_stmt)
    if next_event is not None and next_event.type == event_type:
        return next_event.id

    return None


def _has_sequence_conflict(
    db: Session,
    *,
    employee_id: int,
    event_type: AttendanceType,
    ts_utc: datetime,
    exclude_event_id: int | None = None,
) -> bool:
    prev_stmt = (
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.deleted_at.is_(None),
            AttendanceEvent.ts_utc <= ts_utc,
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )
    next_stmt = (
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.deleted_at.is_(None),
            AttendanceEvent.ts_utc >= ts_utc,
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )
    if exclude_event_id is not None:
        prev_stmt = prev_stmt.where(AttendanceEvent.id != exclude_event_id)
        next_stmt = next_stmt.where(AttendanceEvent.id != exclude_event_id)

    prev_event = db.scalar(prev_stmt)
    next_event = db.scalar(next_stmt)

    if prev_event is not None and prev_event.type == event_type:
        return True
    if next_event is not None and next_event.type == event_type:
        return True
    return False


def _resolve_today_status_for_employee(
    db: Session,
    *,
    employee_id: int,
    reference_ts_utc: datetime | None = None,
) -> tuple[str, AttendanceEvent | None, AttendanceEvent | None, AttendanceEvent | None]:
    reference = _normalize_ts(reference_ts_utc)
    day_start, day_end = _local_day_bounds_utc(reference)

    last_in_event = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.type == AttendanceType.IN,
            AttendanceEvent.ts_utc >= day_start,
            AttendanceEvent.ts_utc < day_end,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )
    last_out_event = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.type == AttendanceType.OUT,
            AttendanceEvent.ts_utc >= day_start,
            AttendanceEvent.ts_utc < day_end,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )
    last_event_today = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.ts_utc >= day_start,
            AttendanceEvent.ts_utc < day_end,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
    )

    if last_in_event is None and last_out_event is None:
        today_status = "NOT_STARTED"
    elif last_out_event is None:
        today_status = "IN_PROGRESS"
    elif last_in_event is None:
        today_status = "FINISHED"
    elif last_in_event.ts_utc > last_out_event.ts_utc:
        today_status = "IN_PROGRESS"
    else:
        today_status = "FINISHED"

    return today_status, last_in_event, last_out_event, last_event_today


def _summarize_daily_cycles(
    db: Session,
    *,
    employee_id: int,
    reference_ts_utc: datetime,
) -> tuple[int, bool]:
    day_start, day_end = _local_day_bounds_utc(reference_ts_utc)
    day_events = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee_id,
                AttendanceEvent.ts_utc >= day_start,
                AttendanceEvent.ts_utc < day_end,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        ).all()
    )

    completed_cycles = 0
    has_open_shift = False
    for event in day_events:
        if event.type == AttendanceType.IN:
            has_open_shift = True
            continue
        if event.type == AttendanceType.OUT and has_open_shift:
            completed_cycles += 1
            has_open_shift = False
    return completed_cycles, has_open_shift


def _has_reached_daily_shift_limit(
    db: Session,
    *,
    employee_id: int,
    reference_ts_utc: datetime,
) -> bool:
    settings = get_settings()
    max_cycles = int(settings.attendance_daily_max_cycles or 0)
    if max_cycles <= 0:
        return False

    completed_cycles, _ = _summarize_daily_cycles(
        db,
        employee_id=employee_id,
        reference_ts_utc=reference_ts_utc,
    )
    return completed_cycles >= max_cycles


def _local_day_from_utc(ts_utc: datetime) -> date:
    return _normalize_ts(ts_utc).astimezone(_attendance_timezone()).date()


def _expire_stale_extra_checkin_approvals(
    db: Session,
    *,
    employee_id: int,
    local_day: date,
    reference_ts_utc: datetime,
) -> None:
    now_utc = _normalize_ts(reference_ts_utc)
    rows = list(
        db.scalars(
            select(AttendanceExtraCheckinApproval).where(
                AttendanceExtraCheckinApproval.employee_id == employee_id,
                AttendanceExtraCheckinApproval.local_day == local_day,
                AttendanceExtraCheckinApproval.status.in_(
                    (
                        EXTRA_CHECKIN_APPROVAL_STATUS_PENDING,
                        EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED,
                    )
                ),
                AttendanceExtraCheckinApproval.expires_at < now_utc,
            )
        ).all()
    )
    if not rows:
        return
    for row in rows:
        row.status = EXTRA_CHECKIN_APPROVAL_STATUS_EXPIRED
    db.commit()


def _resolve_approved_extra_checkin_approval(
    db: Session,
    *,
    employee_id: int,
    local_day: date,
    reference_ts_utc: datetime,
) -> AttendanceExtraCheckinApproval | None:
    _expire_stale_extra_checkin_approvals(
        db,
        employee_id=employee_id,
        local_day=local_day,
        reference_ts_utc=reference_ts_utc,
    )
    now_utc = _normalize_ts(reference_ts_utc)
    return db.scalar(
        select(AttendanceExtraCheckinApproval)
        .where(
            AttendanceExtraCheckinApproval.employee_id == employee_id,
            AttendanceExtraCheckinApproval.local_day == local_day,
            AttendanceExtraCheckinApproval.status == EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED,
            AttendanceExtraCheckinApproval.consumed_at.is_(None),
            AttendanceExtraCheckinApproval.expires_at >= now_utc,
        )
        .order_by(
            AttendanceExtraCheckinApproval.approved_at.desc(),
            AttendanceExtraCheckinApproval.id.desc(),
        )
    )


def _create_or_refresh_extra_checkin_approval_request(
    db: Session,
    *,
    employee: Employee,
    device: Device,
    requested_ts_utc: datetime,
) -> AttendanceExtraCheckinApproval:
    now_utc = _normalize_ts(requested_ts_utc)
    local_day = _local_day_from_utc(now_utc)
    _expire_stale_extra_checkin_approvals(
        db,
        employee_id=employee.id,
        local_day=local_day,
        reference_ts_utc=now_utc,
    )
    pending = db.scalar(
        select(AttendanceExtraCheckinApproval)
        .where(
            AttendanceExtraCheckinApproval.employee_id == employee.id,
            AttendanceExtraCheckinApproval.local_day == local_day,
            AttendanceExtraCheckinApproval.status == EXTRA_CHECKIN_APPROVAL_STATUS_PENDING,
            AttendanceExtraCheckinApproval.expires_at >= now_utc,
        )
        .order_by(AttendanceExtraCheckinApproval.id.desc())
    )
    approval_row = pending
    created_new = False
    if approval_row is None:
        ttl_minutes = max(1, int(get_settings().attendance_extra_checkin_approval_ttl_minutes or 30))
        approval_row = AttendanceExtraCheckinApproval(
            employee_id=employee.id,
            device_id=device.id,
            local_day=local_day,
            approval_token=secrets.token_urlsafe(32),
            status=EXTRA_CHECKIN_APPROVAL_STATUS_PENDING,
            requested_at=now_utc,
            expires_at=now_utc + timedelta(minutes=ttl_minutes),
            approved_at=None,
            approved_by_admin_user_id=None,
            approved_by_username=None,
            consumed_at=None,
            consumed_by_event_id=None,
            push_total_targets=0,
            push_sent=0,
            push_failed=0,
            last_push_at=None,
        )
        db.add(approval_row)
        db.commit()
        db.refresh(approval_row)
        created_new = True

    should_send_push = created_new
    if not should_send_push:
        if approval_row.last_push_at is None:
            should_send_push = True
        else:
            should_send_push = (now_utc - _normalize_ts(approval_row.last_push_at)) >= timedelta(seconds=60)
            # If the previous attempt had no reachable admin target (or no successful send),
            # allow a faster retry so newly-claimed admin devices can start receiving quickly.
            if not should_send_push:
                previous_total_targets = int(approval_row.push_total_targets or 0)
                previous_sent = int(approval_row.push_sent or 0)
                if previous_total_targets <= 0 or previous_sent <= 0:
                    should_send_push = (now_utc - _normalize_ts(approval_row.last_push_at)) >= timedelta(seconds=10)

    if should_send_push:
        employee_name = (employee.full_name or "-").strip() or "-"
        local_day_text = local_day.isoformat()
        push_result = send_push_to_admins(
            db,
            title=f"Ek Giris Onayi Gerekli (#{employee.id})",
            body=(
                f"{employee_name} bugun ikinci giris denemesi yapti. "
                "Onaylamak icin bildirime dokunun."
            ),
            data={
                "type": "ATTENDANCE_EXTRA_CHECKIN_APPROVAL",
                "approval_id": approval_row.id,
                "employee_id": employee.id,
                "employee_name": employee_name,
                "local_day": local_day_text,
                "url": f"/admin-panel/attendance-extra-checkin-approval?token={approval_row.approval_token}",
            },
        )
        approval_row.push_total_targets = int(push_result.get("total_targets", 0))
        approval_row.push_sent = int(push_result.get("sent", 0))
        approval_row.push_failed = int(push_result.get("failed", 0))
        approval_row.last_push_at = now_utc
        db.commit()

    return approval_row


def _consume_extra_checkin_approval(
    approval: AttendanceExtraCheckinApproval,
    *,
    consumed_at_utc: datetime,
    event_id: int,
) -> None:
    approval.status = EXTRA_CHECKIN_APPROVAL_STATUS_CONSUMED
    approval.consumed_at = _normalize_ts(consumed_at_utc)
    approval.consumed_by_event_id = event_id


def _build_attendance_event(
    db: Session,
    *,
    device_fingerprint: str,
    event_type: AttendanceType,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    shift_id: int | None = None,
    qr_site_id: str | None = None,
    extra_flags: dict[str, Any] | None = None,
) -> AttendanceEvent:
    device = _resolve_active_device(db, device_fingerprint)
    employee = device.employee
    if employee is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employee is not active")

    ts_utc = datetime.now(timezone.utc)
    active_open_event = _resolve_active_open_shift_event(
        db,
        employee=employee,
        reference_ts_utc=ts_utc,
    )
    latest_event = _resolve_latest_event_for_employee(
        db,
        employee_id=employee.id,
        reference_ts_utc=ts_utc,
    )
    approved_extra_checkin: AttendanceExtraCheckinApproval | None = None
    if event_type == AttendanceType.IN:
        if active_open_event is not None:
            raise ApiError(
                status_code=409,
                code="ALREADY_CHECKED_IN",
                message="Acik mesai kaydi var. Lutfen once cikis yapin.",
            )
        if _has_reached_daily_shift_limit(
            db,
            employee_id=employee.id,
            reference_ts_utc=ts_utc,
        ):
            local_day = _local_day_from_utc(ts_utc)
            approved_extra_checkin = _resolve_approved_extra_checkin_approval(
                db,
                employee_id=employee.id,
                local_day=local_day,
                reference_ts_utc=ts_utc,
            )
            if approved_extra_checkin is None:
                _create_or_refresh_extra_checkin_approval_request(
                    db,
                    employee=employee,
                    device=device,
                    requested_ts_utc=ts_utc,
                )
                raise ApiError(
                    status_code=409,
                    code="SECOND_CHECKIN_APPROVAL_REQUIRED",
                    message="Bugunku ikinci giris icin admin onayi gerekiyor. Onaydan sonra tekrar deneyin.",
                )
    if event_type == AttendanceType.OUT:
        if active_open_event is None:
            if latest_event is None:
                raise ApiError(
                    status_code=409,
                    code="CHECKIN_REQUIRED",
                    message="Cikis icin once giris kaydi gereklidir.",
                )
            if latest_event.type == AttendanceType.OUT:
                raise ApiError(
                    status_code=409,
                    code="ALREADY_CHECKED_OUT",
                    message="Acik bir mesai bulunamadi. Cikis zaten yapilmis gorunuyor.",
                )
            raise ApiError(
                status_code=409,
                code="CHECKIN_REQUIRED",
                message="Aktif bir giris kaydi bulunamadi. Lutfen once bugun icin giris yapin.",
            )

    employee_location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee.id)
    )
    location_status, location_flags = evaluate_location(employee_location, lat, lon)

    flags: dict[str, Any] = dict(location_flags)
    local_day = _normalize_ts(ts_utc).astimezone(_attendance_timezone()).date()
    effective_plan = resolve_effective_plan_for_employee_day(
        db,
        employee=employee,
        day_date=local_day,
    )
    planned_shift: DepartmentShift | None = None
    if effective_plan is not None and effective_plan.shift_id is not None:
        planned_shift = _resolve_fallback_shift(db, employee=employee, shift_id=effective_plan.shift_id)
    if effective_plan is not None:
        flags["SCHEDULE_PLAN_ID"] = effective_plan.id
        flags["SCHEDULE_PLAN_TARGET_TYPE"] = effective_plan.target_type.value
        if effective_plan.is_locked:
            flags["SCHEDULE_PLAN_LOCKED"] = True

    if (
        effective_plan is not None
        and effective_plan.is_locked
        and effective_plan.shift_id is not None
        and shift_id is not None
        and shift_id != effective_plan.shift_id
    ):
        raise ApiError(
            status_code=409,
            code="SHIFT_LOCKED_BY_PLAN",
            message="This day is locked to a planned shift. Requested shift is not allowed.",
        )

    resolved_shift: DepartmentShift | None = None
    if shift_id is not None:
        resolved_shift = _validate_and_resolve_shift(db, employee=employee, shift_id=shift_id)
        flags["SHIFT_SOURCE"] = "REQUEST"
        if planned_shift is not None and resolved_shift.id != planned_shift.id:
            flags["SCHEDULE_PLAN_OVERRIDE_BY_REQUEST"] = True
    elif event_type == AttendanceType.IN:
        if planned_shift is not None:
            resolved_shift = planned_shift
            flags["SHIFT_SOURCE"] = "SCHEDULE_PLAN"
        else:
            inferred_shift, inferred_diff = _infer_shift_from_checkin_time(
                db,
                employee=employee,
                checkin_ts_utc=ts_utc,
            )
            if inferred_shift is not None:
                resolved_shift = inferred_shift
                flags["AUTO_SHIFT_ASSIGNED"] = True
                flags["SHIFT_SOURCE"] = "AUTO_CHECKIN_TIME"
                if inferred_diff is not None:
                    flags["SHIFT_START_DIFF_MINUTES"] = inferred_diff
                    if inferred_diff > 120:
                        flags["NEEDS_SHIFT_REVIEW"] = True
            else:
                fallback_shift = _resolve_fallback_shift(db, employee=employee, shift_id=employee.shift_id)
                if fallback_shift is not None:
                    resolved_shift = fallback_shift
                    flags["SHIFT_SOURCE"] = "EMPLOYEE_DEFAULT"
    else:
        inherited_shift = _resolve_shift_from_last_checkin(
            db,
            employee=employee,
            reference_ts_utc=ts_utc,
        )
        if inherited_shift is not None:
            resolved_shift = inherited_shift
            flags["SHIFT_SOURCE"] = "INHERITED_FROM_CHECKIN"
        elif planned_shift is not None:
            resolved_shift = planned_shift
            flags["SHIFT_SOURCE"] = "SCHEDULE_PLAN"
        else:
            fallback_shift = _resolve_fallback_shift(db, employee=employee, shift_id=employee.shift_id)
            if fallback_shift is not None:
                resolved_shift = fallback_shift
                flags["SHIFT_SOURCE"] = "EMPLOYEE_DEFAULT"

    if resolved_shift is not None:
        flags["SHIFT_ID"] = resolved_shift.id
        flags["SHIFT_NAME"] = resolved_shift.name
    if qr_site_id:
        flags["QR_SITE_ID"] = qr_site_id
    if approved_extra_checkin is not None:
        flags["SECOND_CHECKIN_APPROVED"] = True
        flags["SECOND_CHECKIN_APPROVAL_ID"] = approved_extra_checkin.id
    if extra_flags:
        flags.update(extra_flags)

    duplicate_of = _duplicate_event_id(db, employee.id, event_type, ts_utc)
    if duplicate_of is not None:
        flags["DUPLICATE_EVENT"] = True
        flags["duplicate_of"] = duplicate_of

    event = AttendanceEvent(
        employee_id=employee.id,
        device_id=device.id,
        type=event_type,
        ts_utc=ts_utc,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        location_status=location_status,
        flags=flags,
        source=AttendanceEventSource.DEVICE,
        created_by_admin=False,
        note=None,
    )
    db.add(event)
    db.flush()
    if approved_extra_checkin is not None:
        _consume_extra_checkin_approval(
            approved_extra_checkin,
            consumed_at_utc=ts_utc,
            event_id=event.id,
        )
    db.commit()
    db.refresh(event)
    return event


def create_checkin_event(
    db: Session,
    *,
    device_fingerprint: str,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    shift_id: int | None = None,
    qr_site_id: str | None = None,
) -> AttendanceEvent:
    return _build_attendance_event(
        db,
        device_fingerprint=device_fingerprint,
        event_type=AttendanceType.IN,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        shift_id=shift_id,
        qr_site_id=qr_site_id,
    )


def create_checkout_event(
    db: Session,
    *,
    device_fingerprint: str,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    manual: bool = False,
) -> AttendanceEvent:
    extra_flags: dict[str, Any] | None = None
    if manual:
        extra_flags = {"MANUAL_CHECKOUT": True}

    return _build_attendance_event(
        db,
        device_fingerprint=device_fingerprint,
        event_type=AttendanceType.OUT,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        extra_flags=extra_flags,
    )


def create_attendance_event(db: Session, payload: AttendanceEventCreate) -> AttendanceEvent:
    ts_utc = _normalize_ts(payload.ts_utc)
    device = _resolve_active_device(db, payload.device_fingerprint)
    employee = device.employee
    if employee is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employee is not active")

    employee_location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee.id)
    )
    location_status, flags = evaluate_location(employee_location, payload.lat, payload.lon)

    event = AttendanceEvent(
        employee_id=employee.id,
        device_id=device.id,
        type=payload.type,
        ts_utc=ts_utc,
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m,
        location_status=location_status,
        flags=flags,
        source=AttendanceEventSource.DEVICE,
        created_by_admin=False,
        note=None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _resolve_employee(db: Session, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def _resolve_device_for_admin_manual_event(db: Session, employee_id: int) -> Device:
    active_device = db.scalar(
        select(Device)
        .where(
            Device.employee_id == employee_id,
            Device.is_active.is_(True),
        )
        .order_by(Device.id.asc())
    )
    if active_device is not None:
        return active_device

    manual_fingerprint = f"admin-manual-employee-{employee_id}"
    existing_manual_device = db.scalar(
        select(Device).where(Device.device_fingerprint == manual_fingerprint)
    )
    if existing_manual_device is not None:
        if not existing_manual_device.is_active:
            existing_manual_device.is_active = True
        return existing_manual_device

    manual_device = Device(
        employee_id=employee_id,
        device_fingerprint=manual_fingerprint,
        is_active=True,
    )
    db.add(manual_device)
    db.flush()
    return manual_device


def create_admin_manual_event(
    db: Session,
    *,
    employee_id: int,
    event_type: AttendanceType,
    ts_utc: datetime | None,
    ts_local: datetime | None = None,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    note: str | None = None,
    shift_id: int | None = None,
    allow_duplicate: bool = False,
) -> AttendanceEvent:
    employee = _resolve_employee(db, employee_id)
    normalized_ts = _normalize_local_or_utc(ts_utc=ts_utc, ts_local=ts_local)

    device = _resolve_device_for_admin_manual_event(db, employee_id)
    employee_location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee.id)
    )
    location_status, location_flags = evaluate_location(employee_location, lat, lon)

    flags: dict[str, Any] = dict(location_flags)
    flags["ADMIN_MANUAL"] = True
    flags["MANUAL_EVENT"] = True
    resolved_shift = _validate_and_resolve_shift(db, employee=employee, shift_id=shift_id)
    if resolved_shift is not None:
        flags["SHIFT_ID"] = resolved_shift.id
        flags["SHIFT_NAME"] = resolved_shift.name
    if note:
        flags["manual_note"] = note

    has_sequence_conflict = _has_sequence_conflict(
        db,
        employee_id=employee.id,
        event_type=event_type,
        ts_utc=normalized_ts,
    )
    if has_sequence_conflict and not allow_duplicate:
        raise ApiError(
            status_code=409,
            code="INVALID_EVENT_SEQUENCE",
            message="Ard arda ayni tip event olusuyor. Gerekirse duplicate onayi verin.",
        )

    duplicate_of = _duplicate_event_id(db, employee.id, event_type, normalized_ts)
    if duplicate_of is not None or has_sequence_conflict:
        flags["DUPLICATE_EVENT"] = True
    if duplicate_of is not None:
        flags["duplicate_of"] = duplicate_of

    event = AttendanceEvent(
        employee_id=employee.id,
        device_id=device.id,
        type=event_type,
        ts_utc=normalized_ts,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        location_status=location_status,
        flags=flags,
        source=AttendanceEventSource.MANUAL,
        created_by_admin=True,
        note=note,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _resolve_admin_editable_event(db: Session, event_id: int) -> AttendanceEvent:
    event = db.get(AttendanceEvent, event_id)
    if event is None or event.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance event not found")
    return event


def update_admin_manual_event(
    db: Session,
    *,
    event_id: int,
    event_type: AttendanceType | None,
    ts_utc: datetime | None,
    ts_local: datetime | None,
    note: str | None,
    shift_id: int | None = None,
    allow_duplicate: bool = False,
    force_edit: bool = False,
) -> AttendanceEvent:
    event = _resolve_admin_editable_event(db, event_id)
    if not force_edit and not (event.created_by_admin or event.source == AttendanceEventSource.MANUAL):
        raise ApiError(
            status_code=403,
            code="FORBIDDEN",
            message="Bu event sadece admin kaydi ise duzenlenebilir.",
        )

    new_type = event_type or event.type
    new_ts = (
        _normalize_local_or_utc(ts_utc=ts_utc, ts_local=ts_local)
        if (ts_utc is not None or ts_local is not None)
        else _normalize_ts(event.ts_utc)
    )

    has_sequence_conflict = _has_sequence_conflict(
        db,
        employee_id=event.employee_id,
        event_type=new_type,
        ts_utc=new_ts,
        exclude_event_id=event.id,
    )
    if has_sequence_conflict and not allow_duplicate:
        raise ApiError(
            status_code=409,
            code="INVALID_EVENT_SEQUENCE",
            message="Ard arda ayni tip event olusuyor. Gerekirse duplicate onayi verin.",
        )

    flags = dict(event.flags or {})
    flags["ADMIN_MANUAL"] = True
    flags["MANUAL_EVENT"] = True
    if shift_id is not None:
        employee = _resolve_employee(db, event.employee_id)
        resolved_shift = _validate_and_resolve_shift(db, employee=employee, shift_id=shift_id)
        if resolved_shift is not None:
            flags["SHIFT_ID"] = resolved_shift.id
            flags["SHIFT_NAME"] = resolved_shift.name
    duplicate_of = _duplicate_event_id(
        db,
        event.employee_id,
        new_type,
        new_ts,
        exclude_event_id=event.id,
    )
    if duplicate_of is not None or has_sequence_conflict:
        flags["DUPLICATE_EVENT"] = True
        if duplicate_of is not None:
            flags["duplicate_of"] = duplicate_of
    else:
        flags.pop("DUPLICATE_EVENT", None)
        flags.pop("duplicate_of", None)

    if note is not None:
        event.note = note
        if note:
            flags["manual_note"] = note
        else:
            flags.pop("manual_note", None)

    event.type = new_type
    event.ts_utc = new_ts
    event.flags = flags
    event.source = AttendanceEventSource.MANUAL
    event.created_by_admin = True
    db.commit()
    db.refresh(event)
    return event


def soft_delete_admin_attendance_event(
    db: Session,
    *,
    event_id: int,
    force_delete: bool = False,
) -> AttendanceEvent:
    event = _resolve_admin_editable_event(db, event_id)
    if not force_delete and not (event.created_by_admin or event.source == AttendanceEventSource.MANUAL):
        raise ApiError(
            status_code=403,
            code="FORBIDDEN",
            message="Bu event sadece admin kaydi ise silinebilir.",
        )

    event.deleted_at = datetime.now(timezone.utc)
    event.deleted_by_admin = True
    flags = dict(event.flags or {})
    flags["SOFT_DELETED"] = True
    event.flags = flags
    db.commit()
    db.refresh(event)
    return event


def get_employee_status_by_device(
    db: Session,
    *,
    device_fingerprint: str,
) -> dict[str, Any]:
    device = _resolve_active_device(db, device_fingerprint)
    employee = device.employee
    if employee is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employee is not active")

    reference_now_utc = datetime.now(timezone.utc)
    today_status, last_in_event, last_out_event, last_event_today = _resolve_today_status_for_employee(
        db,
        employee_id=employee.id,
        reference_ts_utc=reference_now_utc,
    )
    completed_cycles_today, has_open_shift = _summarize_daily_cycles(
        db,
        employee_id=employee.id,
        reference_ts_utc=reference_now_utc,
    )
    passkey_registered = db.scalar(
        select(DevicePasskey.id).where(
            DevicePasskey.device_id == device.id,
            DevicePasskey.is_active.is_(True),
        )
    ) is not None
    home_location_required = db.scalar(
        select(EmployeeLocation.id).where(EmployeeLocation.employee_id == employee.id)
    ) is None
    suggested_action = (
        "CHECKOUT"
        if has_open_shift
        else ("CHECKIN" if today_status == "NOT_STARTED" else "WAIT_NEXT_DAY")
    )
    assigned_shift = employee.shift
    shift_start_local = assigned_shift.start_time_local.strftime("%H:%M") if assigned_shift else None
    shift_end_local = assigned_shift.end_time_local.strftime("%H:%M") if assigned_shift else None

    return {
        "employee_id": employee.id,
        "employee_name": employee.full_name,
        "region_name": employee.region.name if employee.region is not None else None,
        "department_name": employee.department.name if employee.department is not None else None,
        "shift_name": assigned_shift.name if assigned_shift is not None else None,
        "shift_start_local": shift_start_local,
        "shift_end_local": shift_end_local,
        "today_status": today_status,
        "last_in_ts": last_in_event.ts_utc if last_in_event is not None else None,
        "last_out_ts": last_out_event.ts_utc if last_out_event is not None else None,
        "last_location_status": (
            last_event_today.location_status if last_event_today is not None else None
        ),
        "last_flags": last_event_today.flags if last_event_today is not None else {},
        "has_open_shift": has_open_shift,
        "suggested_action": suggested_action,
        "last_checkin_time_utc": last_in_event.ts_utc if last_in_event is not None else None,
        "completed_cycles_today": completed_cycles_today,
        "home_location_required": home_location_required,
        "passkey_registered": passkey_registered,
    }


def create_employee_home_location(
    db: Session,
    *,
    device_fingerprint: str,
    home_lat: float,
    home_lon: float,
    radius_m: int,
) -> EmployeeLocation:
    device = db.scalar(
        select(Device).where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Device must be claimed before setting home location.",
        )
    employee = device.employee
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Employee not found for this device.",
        )
    if not employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee cannot set home location.",
        )

    existing_location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == device.employee_id)
    )
    if existing_location is not None:
        raise ApiError(
            status_code=409,
            code="HOME_LOCATION_ALREADY_SET",
            message="Home location already exists.",
        )

    location = EmployeeLocation(
        employee_id=device.employee_id,
        home_lat=home_lat,
        home_lon=home_lon,
        radius_m=radius_m,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return location
