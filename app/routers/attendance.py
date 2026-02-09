from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.db import get_db
from app.errors import ApiError
from app.models import AuditActorType, Device, DeviceInvite, Employee
from app.schemas import (
    AttendanceActionResponse,
    AttendanceCheckinRequest,
    AttendanceCheckoutRequest,
    AttendanceEventCreate,
    AttendanceEventRead,
    DeviceClaimRequest,
    DeviceClaimResponse,
    EmployeeHomeLocationSetRequest,
    EmployeeHomeLocationSetResponse,
    EmployeeStatusResponse,
)
from app.services.attendance import (
    create_employee_home_location,
    create_attendance_event,
    create_checkin_event,
    create_checkout_event,
    get_employee_status_by_device,
)

router = APIRouter(tags=["attendance"])


def _client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


@router.post("/attendance/event", response_model=AttendanceEventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: AttendanceEventCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceEventRead:
    request.state.actor = "employee"
    event = create_attendance_event(db, payload)
    request.state.employee_id = event.employee_id
    request.state.event_id = event.id
    request.state.location_status = event.location_status.value
    request.state.flags = event.flags or {}
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(event.employee_id),
        action="ATTENDANCE_EVENT_CREATED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "event_type": event.type.value,
            "location_status": event.location_status.value,
            "flags": event.flags or {},
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return event


@router.post("/api/attendance/checkin", response_model=AttendanceActionResponse)
def checkin(
    payload: AttendanceCheckinRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceActionResponse:
    request.state.actor = "employee"
    event = create_checkin_event(
        db,
        device_fingerprint=payload.device_fingerprint,
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m,
        qr_site_id=payload.qr.site_id,
        shift_id=payload.qr.shift_id,
    )
    request.state.employee_id = event.employee_id
    request.state.event_id = event.id
    request.state.location_status = event.location_status.value
    request.state.flags = event.flags or {}
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(event.employee_id),
        action="ATTENDANCE_EVENT_CREATED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "event_type": event.type.value,
            "location_status": event.location_status.value,
            "flags": event.flags or {},
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AttendanceActionResponse(
        ok=True,
        employee_id=event.employee_id,
        event_id=event.id,
        event_type=event.type,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        flags=event.flags or {},
        shift_id=(
            int((event.flags or {}).get("SHIFT_ID"))
            if isinstance((event.flags or {}).get("SHIFT_ID"), int)
            else None
        ),
    )


@router.post("/api/attendance/checkout", response_model=AttendanceActionResponse)
def checkout(
    payload: AttendanceCheckoutRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceActionResponse:
    request.state.actor = "employee"
    event = create_checkout_event(
        db,
        device_fingerprint=payload.device_fingerprint,
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m,
        manual=payload.manual,
    )
    request.state.employee_id = event.employee_id
    request.state.event_id = event.id
    request.state.location_status = event.location_status.value
    request.state.flags = event.flags or {}
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(event.employee_id),
        action="ATTENDANCE_EVENT_CREATED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "event_type": event.type.value,
            "location_status": event.location_status.value,
            "flags": event.flags or {},
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AttendanceActionResponse(
        ok=True,
        employee_id=event.employee_id,
        event_id=event.id,
        event_type=event.type,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        flags=event.flags or {},
        shift_id=(
            int((event.flags or {}).get("SHIFT_ID"))
            if isinstance((event.flags or {}).get("SHIFT_ID"), int)
            else None
        ),
    )


@router.post("/api/device/claim", response_model=DeviceClaimResponse, status_code=status.HTTP_201_CREATED)
def claim_device(
    payload: DeviceClaimRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> DeviceClaimResponse:
    request.state.actor = "employee"
    invite = db.scalar(select(DeviceInvite).where(DeviceInvite.token == payload.token))
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite token not found")

    if invite.is_used:
        raise HTTPException(status_code=400, detail="Invite token already used")

    now_utc = datetime.now(timezone.utc)
    if invite.expires_at < now_utc:
        raise HTTPException(status_code=400, detail="Invite token expired")

    invite_employee = invite.employee
    if invite_employee is None:
        invite_employee = db.get(Employee, invite.employee_id)
    if invite_employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")
    if not invite_employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee cannot claim devices.",
        )

    existing_device = db.scalar(
        select(Device).where(Device.device_fingerprint == payload.device_fingerprint)
    )
    if existing_device is not None and existing_device.employee_id != invite.employee_id:
        raise HTTPException(
            status_code=409,
            detail="Device fingerprint already belongs to another employee",
        )

    device: Device
    deactivated_device_ids: list[int] = []
    active_devices = list(
        db.scalars(
            select(Device).where(
                Device.employee_id == invite.employee_id,
                Device.is_active.is_(True),
            )
        ).all()
    )
    for active_device in active_devices:
        if active_device.device_fingerprint == payload.device_fingerprint:
            continue
        active_device.is_active = False
        deactivated_device_ids.append(active_device.id)

    if existing_device is not None:
        existing_device.employee_id = invite.employee_id
        existing_device.is_active = True
        device = existing_device
    else:
        device = Device(
            employee_id=invite.employee_id,
            device_fingerprint=payload.device_fingerprint,
            is_active=True,
        )
        db.add(device)

    invite.is_used = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Device fingerprint already registered")

    db.refresh(device)
    request.state.employee_id = invite.employee_id
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(invite.employee_id),
        action="DEVICE_CLAIMED",
        success=True,
        entity_type="device",
        entity_id=str(device.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "device_fingerprint": payload.device_fingerprint,
            "deactivated_device_ids": deactivated_device_ids,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return DeviceClaimResponse(ok=True, employee_id=invite.employee_id, device_id=device.id)


@router.get("/api/employee/status", response_model=EmployeeStatusResponse)
def employee_status(
    device_fingerprint: str,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeStatusResponse:
    request.state.actor = "employee"
    status_data = get_employee_status_by_device(db, device_fingerprint=device_fingerprint)
    request.state.employee_id = status_data["employee_id"]
    last_location_status = status_data["last_location_status"]
    request.state.location_status = last_location_status.value if last_location_status else None
    request.state.flags = status_data["last_flags"]
    return EmployeeStatusResponse(**status_data)


@router.post("/api/employee/home-location", response_model=EmployeeHomeLocationSetResponse)
def employee_set_home_location(
    payload: EmployeeHomeLocationSetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeHomeLocationSetResponse:
    request.state.actor = "employee"
    location = create_employee_home_location(
        db,
        device_fingerprint=payload.device_fingerprint,
        home_lat=payload.home_lat,
        home_lon=payload.home_lon,
        radius_m=payload.radius_m,
    )
    request.state.employee_id = location.employee_id
    return EmployeeHomeLocationSetResponse(
        ok=True,
        employee_id=location.employee_id,
        home_lat=location.home_lat,
        home_lon=location.home_lon,
        radius_m=location.radius_m,
    )

