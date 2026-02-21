from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
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
    EmployeePushConfigResponse,
    EmployeePushSubscribeRequest,
    EmployeePushSubscribeResponse,
    EmployeePushUnsubscribeRequest,
    EmployeePushUnsubscribeResponse,
    EmployeeQrScanDeniedResponse,
    EmployeeQrScanRequest,
    EmployeeStatusResponse,
    PasskeyRecoverOptionsResponse,
    PasskeyRecoverVerifyRequest,
    PasskeyRecoverVerifyResponse,
    PasskeyRegisterOptionsRequest,
    PasskeyRegisterOptionsResponse,
    PasskeyRegisterVerifyRequest,
    PasskeyRegisterVerifyResponse,
    RecoveryCodeIssueRequest,
    RecoveryCodeIssueResponse,
    RecoveryCodeRecoverRequest,
    RecoveryCodeRecoverResponse,
    RecoveryCodeStatusResponse,
)
from app.services.push_notifications import (
    deactivate_device_push_subscription,
    get_push_public_config,
    send_test_push_to_device_subscription,
    upsert_device_push_subscription,
)
from app.services.attendance import (
    QRScanDeniedError,
    create_employee_home_location,
    create_attendance_event,
    create_employee_qr_scan_event,
    create_checkin_event,
    create_checkout_event,
    get_employee_status_by_device,
)
from app.services.passkeys import (
    create_recover_options,
    create_registration_options,
    verify_recover,
    verify_registration,
)
from app.services.recovery_codes import (
    get_recovery_status,
    issue_recovery_codes,
    recover_device_with_code,
)

router = APIRouter(tags=["attendance"])
DEVICE_FINGERPRINT_COOKIE = "pf_device_fingerprint"
DEVICE_FINGERPRINT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 3


def _client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _is_secure_request(request: Request) -> bool:
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").strip().lower()
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip() == "https"
    return request.url.scheme == "https"


def _set_device_fingerprint_cookie(
    *,
    response: Response,
    request: Request,
    device_fingerprint: str,
) -> None:
    normalized = device_fingerprint.strip()
    if not normalized:
        return
    response.set_cookie(
        key=DEVICE_FINGERPRINT_COOKIE,
        value=normalized,
        max_age=DEVICE_FINGERPRINT_COOKIE_MAX_AGE_SECONDS,
        path="/",
        samesite="lax",
        secure=_is_secure_request(request),
        httponly=False,
    )


def _archived_device_fingerprint(source_fingerprint: str, device_id: int) -> str:
    # Keep historical device row but free the original fingerprint for reassignment.
    suffix = f"::archived:{device_id}:{int(datetime.now(timezone.utc).timestamp())}"
    max_base_len = max(1, 255 - len(suffix))
    return f"{source_fingerprint[:max_base_len]}{suffix}"


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


@router.post(
    "/api/employee/qr/scan",
    response_model=AttendanceActionResponse,
    responses={403: {"model": EmployeeQrScanDeniedResponse}},
)
def employee_qr_scan(
    payload: EmployeeQrScanRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    request.state.actor = "employee"
    try:
        event = create_employee_qr_scan_event(
            db,
            device_fingerprint=payload.device_fingerprint,
            code_value=payload.code_value,
            lat=payload.lat,
            lon=payload.lon,
            accuracy_m=payload.accuracy_m,
        )
    except QRScanDeniedError as exc:
        request.state.employee_id = exc.employee_id
        request.state.flags = {
            "reason": exc.reason,
            "closest_distance_m": exc.closest_distance_m,
        }
        log_audit(
            db,
            actor_type=AuditActorType.SYSTEM,
            actor_id=str(exc.employee_id or "unknown"),
            action="QR_SCAN_DENIED",
            success=False,
            entity_type="qr_code",
            entity_id=(str(exc.code_id) if exc.code_id is not None else None),
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            details={
                "reason": exc.reason,
                "closest_distance_m": exc.closest_distance_m,
                "code_value": payload.code_value,
            },
            request_id=getattr(request.state, "request_id", None),
        )
        return JSONResponse(
            status_code=403,
            content={
                "reason": exc.reason,
                "closest_distance_m": exc.closest_distance_m,
            },
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
    response: Response,
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
    transferred_from_employee_id: int | None = None
    archived_device_id: int | None = None
    if existing_device is not None and existing_device.employee_id != invite.employee_id:
        if existing_device.is_active:
            raise HTTPException(
                status_code=409,
                detail="Device fingerprint already belongs to another employee",
            )
        transferred_from_employee_id = existing_device.employee_id
        archived_device_id = existing_device.id
        existing_device.device_fingerprint = _archived_device_fingerprint(
            payload.device_fingerprint,
            existing_device.id,
        )
        existing_device = None

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
            "transferred_from_employee_id": transferred_from_employee_id,
            "archived_device_id": archived_device_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    _set_device_fingerprint_cookie(
        response=response,
        request=request,
        device_fingerprint=payload.device_fingerprint,
    )
    return DeviceClaimResponse(ok=True, employee_id=invite.employee_id, device_id=device.id)


@router.post(
    "/api/device/passkey/register/options",
    response_model=PasskeyRegisterOptionsResponse,
)
def device_passkey_register_options(
    payload: PasskeyRegisterOptionsRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PasskeyRegisterOptionsResponse:
    request.state.actor = "employee"
    challenge, options_json = create_registration_options(
        db,
        device_fingerprint=payload.device_fingerprint,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
    )
    request.state.employee_id = challenge.device.employee_id if challenge.device is not None else None
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(request.state.employee_id or "unknown"),
        action="PASSKEY_REGISTER_OPTIONS_CREATED",
        success=True,
        entity_type="webauthn_challenge",
        entity_id=str(challenge.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"purpose": "register"},
        request_id=getattr(request.state, "request_id", None),
    )
    return PasskeyRegisterOptionsResponse(
        challenge_id=challenge.id,
        expires_at=challenge.expires_at,
        options=options_json,
    )


@router.post(
    "/api/device/passkey/register/verify",
    response_model=PasskeyRegisterVerifyResponse,
)
def device_passkey_register_verify(
    payload: PasskeyRegisterVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PasskeyRegisterVerifyResponse:
    request.state.actor = "employee"
    passkey = verify_registration(
        db,
        challenge_id=payload.challenge_id,
        credential=payload.credential,
    )
    request.state.employee_id = passkey.device.employee_id if passkey.device is not None else None
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(request.state.employee_id or "unknown"),
        action="PASSKEY_REGISTERED",
        success=True,
        entity_type="device_passkey",
        entity_id=str(passkey.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"device_id": passkey.device_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return PasskeyRegisterVerifyResponse(ok=True, passkey_id=passkey.id)


@router.post(
    "/api/device/passkey/recover/options",
    response_model=PasskeyRecoverOptionsResponse,
)
def device_passkey_recover_options(
    request: Request,
    db: Session = Depends(get_db),
) -> PasskeyRecoverOptionsResponse:
    request.state.actor = "employee"
    challenge, options_json = create_recover_options(
        db,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
    )
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id="system",
        action="PASSKEY_RECOVER_OPTIONS_CREATED",
        success=True,
        entity_type="webauthn_challenge",
        entity_id=str(challenge.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"purpose": "recover"},
        request_id=getattr(request.state, "request_id", None),
    )
    return PasskeyRecoverOptionsResponse(
        challenge_id=challenge.id,
        expires_at=challenge.expires_at,
        options=options_json,
    )


@router.post(
    "/api/device/passkey/recover/verify",
    response_model=PasskeyRecoverVerifyResponse,
)
def device_passkey_recover_verify(
    payload: PasskeyRecoverVerifyRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> PasskeyRecoverVerifyResponse:
    request.state.actor = "employee"
    device = verify_recover(
        db,
        challenge_id=payload.challenge_id,
        credential=payload.credential,
    )
    employee_id = device.employee_id
    request.state.employee_id = employee_id
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(employee_id),
        action="PASSKEY_RECOVERED",
        success=True,
        entity_type="device",
        entity_id=str(device.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"device_fingerprint": device.device_fingerprint},
        request_id=getattr(request.state, "request_id", None),
    )
    _set_device_fingerprint_cookie(
        response=response,
        request=request,
        device_fingerprint=device.device_fingerprint,
    )
    return PasskeyRecoverVerifyResponse(
        ok=True,
        employee_id=employee_id,
        device_id=device.id,
        device_fingerprint=device.device_fingerprint,
    )


@router.post(
    "/api/device/recovery-codes/issue",
    response_model=RecoveryCodeIssueResponse,
)
def device_recovery_codes_issue(
    payload: RecoveryCodeIssueRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> RecoveryCodeIssueResponse:
    request.state.actor = "employee"
    device, recovery_codes, expires_at = issue_recovery_codes(
        db,
        device_fingerprint=payload.device_fingerprint,
        recovery_pin=payload.recovery_pin,
    )
    request.state.employee_id = device.employee_id
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(device.employee_id),
        action="RECOVERY_CODES_ISSUED",
        success=True,
        entity_type="device",
        entity_id=str(device.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "code_count": len(recovery_codes),
            "expires_at": expires_at.isoformat(),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return RecoveryCodeIssueResponse(
        ok=True,
        employee_id=device.employee_id,
        device_id=device.id,
        code_count=len(recovery_codes),
        expires_at=expires_at,
        recovery_codes=recovery_codes,
    )


@router.get(
    "/api/device/recovery-codes/status",
    response_model=RecoveryCodeStatusResponse,
)
def device_recovery_codes_status(
    device_fingerprint: str,
    request: Request,
    db: Session = Depends(get_db),
) -> RecoveryCodeStatusResponse:
    request.state.actor = "employee"
    status_data = get_recovery_status(db, device_fingerprint=device_fingerprint)
    request.state.employee_id = status_data["employee_id"]
    return RecoveryCodeStatusResponse(**status_data)


@router.post(
    "/api/device/recovery-codes/recover",
    response_model=RecoveryCodeRecoverResponse,
)
def device_recovery_codes_recover(
    payload: RecoveryCodeRecoverRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> RecoveryCodeRecoverResponse:
    request.state.actor = "employee"
    device = recover_device_with_code(
        db,
        employee_id=payload.employee_id,
        recovery_pin=payload.recovery_pin,
        recovery_code=payload.recovery_code,
    )
    request.state.employee_id = device.employee_id
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(device.employee_id),
        action="RECOVERY_CODE_RECOVERED",
        success=True,
        entity_type="device",
        entity_id=str(device.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={},
        request_id=getattr(request.state, "request_id", None),
    )
    _set_device_fingerprint_cookie(
        response=response,
        request=request,
        device_fingerprint=device.device_fingerprint,
    )
    return RecoveryCodeRecoverResponse(
        ok=True,
        employee_id=device.employee_id,
        device_id=device.id,
        device_fingerprint=device.device_fingerprint,
    )


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


@router.get("/api/employee/push/config", response_model=EmployeePushConfigResponse)
def employee_push_config() -> EmployeePushConfigResponse:
    return EmployeePushConfigResponse(**get_push_public_config())


@router.post("/api/employee/push/subscribe", response_model=EmployeePushSubscribeResponse)
def employee_push_subscribe(
    payload: EmployeePushSubscribeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeePushSubscribeResponse:
    request.state.actor = "employee"
    subscription = upsert_device_push_subscription(
        db,
        device_fingerprint=payload.device_fingerprint,
        subscription=payload.subscription,
        user_agent=_user_agent(request),
    )
    test_push_ok: bool | None = None
    test_push_error: str | None = None
    test_push_status_code: int | None = None
    if payload.send_test:
        test_result = send_test_push_to_device_subscription(
            db,
            subscription=subscription,
            data={"url": "/employee/", "origin": "employee_push_subscribe_test"},
        )
        test_push_ok = bool(test_result.get("ok"))
        test_push_error = (
            str(test_result["error"]).strip() if test_result.get("error") is not None else None
        )
        status_code = test_result.get("status_code")
        test_push_status_code = int(status_code) if isinstance(status_code, int) else None

    employee_id = subscription.device.employee_id if subscription.device is not None else None
    request.state.employee_id = employee_id
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id=str(employee_id or "unknown"),
        action="PUSH_SUBSCRIPTION_UPSERT",
        success=True,
        entity_type="device_push_subscription",
        entity_id=str(subscription.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "device_id": subscription.device_id,
            "endpoint": subscription.endpoint,
            "send_test": payload.send_test,
            "test_push_ok": test_push_ok,
            "test_push_status_code": test_push_status_code,
            "test_push_error": test_push_error,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return EmployeePushSubscribeResponse(
        ok=True,
        subscription_id=subscription.id,
        test_push_ok=test_push_ok,
        test_push_error=test_push_error,
        test_push_status_code=test_push_status_code,
    )


@router.post("/api/employee/push/unsubscribe", response_model=EmployeePushUnsubscribeResponse)
def employee_push_unsubscribe(
    payload: EmployeePushUnsubscribeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeePushUnsubscribeResponse:
    request.state.actor = "employee"
    removed = deactivate_device_push_subscription(
        db,
        device_fingerprint=payload.device_fingerprint,
        endpoint=payload.endpoint,
    )
    log_audit(
        db,
        actor_type=AuditActorType.SYSTEM,
        actor_id="employee",
        action="PUSH_SUBSCRIPTION_REMOVE",
        success=True,
        entity_type="device_push_subscription",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "endpoint": payload.endpoint,
            "removed": removed,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return EmployeePushUnsubscribeResponse(ok=True)


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

