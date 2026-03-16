from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    AttendanceEvent,
    AttendanceType,
    EmployeeLocation,
    EmployeeLocationEvent,
    GeofenceStatus,
    LocationEventSource,
    LocationStatus,
    LocationTrustStatus,
)
from app.services.activity_events import (
    EVENT_APP_DEMO_END,
    EVENT_APP_DEMO_MARK,
    EVENT_APP_DEMO_START,
    EVENT_APP_LAST_SEEN,
    EVENT_LOCATION_PING,
)
from app.services.location import evaluate_location, trust_status_from_score


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed:
        return None
    return parsed


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return None


def _app_source_to_location_source(source: str | None, event_type: str | None) -> LocationEventSource:
    normalized_source = str(source or "").strip().upper()
    normalized_event_type = str(event_type or "").strip().lower()
    if normalized_source == "APP_CLOSE" or normalized_event_type == EVENT_APP_LAST_SEEN:
        return LocationEventSource.APP_CLOSE
    if normalized_source == "DEMO_END" or normalized_event_type == EVENT_APP_DEMO_END:
        return LocationEventSource.DEMO_END
    if normalized_source in {"DEMO_START", "DEMO_MARK"} or normalized_event_type in {EVENT_APP_DEMO_START, EVENT_APP_DEMO_MARK}:
        return LocationEventSource.DEMO_START
    if normalized_event_type == EVENT_LOCATION_PING:
        return LocationEventSource.LOCATION_PING
    return LocationEventSource.APP_OPEN


def _attendance_type_to_location_source(event_type: AttendanceType) -> LocationEventSource:
    return LocationEventSource.CHECKIN if event_type == AttendanceType.IN else LocationEventSource.CHECKOUT


def _get_employee_home_location(db: Session, employee_id: int) -> EmployeeLocation | None:
    return db.scalar(select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id))


def _previous_location_event(
    db: Session,
    *,
    employee_id: int,
    before_ts_utc: datetime,
    exclude_event_id: int | None = None,
) -> EmployeeLocationEvent | None:
    stmt = (
        select(EmployeeLocationEvent)
        .where(
            EmployeeLocationEvent.employee_id == employee_id,
            EmployeeLocationEvent.ts_utc < before_ts_utc,
            EmployeeLocationEvent.lat.is_not(None),
            EmployeeLocationEvent.lon.is_not(None),
        )
        .order_by(EmployeeLocationEvent.ts_utc.desc(), EmployeeLocationEvent.id.desc())
        .limit(1)
    )
    if exclude_event_id is not None:
        stmt = stmt.where(EmployeeLocationEvent.id != exclude_event_id)
    return db.scalar(stmt)


def _apply_location_evaluation(
    *,
    location_event: EmployeeLocationEvent,
    employee_location: EmployeeLocation | None,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    ts_utc: datetime,
    previous_event: EmployeeLocationEvent | None,
    is_mocked: bool | None,
) -> dict[str, Any]:
    location_status, flags = evaluate_location(
        employee_location,
        lat,
        lon,
        accuracy_m=accuracy_m,
        captured_at_utc=ts_utc,
        previous_lat=previous_event.lat if previous_event is not None else None,
        previous_lon=previous_event.lon if previous_event is not None else None,
        previous_ts_utc=previous_event.ts_utc if previous_event is not None else None,
        is_mocked=is_mocked,
    )
    trust_score = int(flags.get("trust_score") or 0)
    device_changed = False
    provider_changed = False
    previous_device_id = previous_event.device_id if previous_event is not None else None
    previous_provider = (previous_event.provider or "").strip().lower() if previous_event is not None else ""
    current_provider = (location_event.provider or "").strip().lower()

    if (
        previous_event is not None
        and previous_device_id is not None
        and location_event.device_id is not None
        and previous_device_id != location_event.device_id
    ):
        device_changed = True
        trust_score = max(0, trust_score - 10)

    if previous_provider and current_provider and previous_provider != current_provider:
        provider_changed = True
        trust_score = max(0, trust_score - 4)

    geofence_status_value = str(flags.get("geofence_status") or GeofenceStatus.UNKNOWN.value)
    suspicious = location_status in {
        LocationStatus.SUSPICIOUS_JUMP,
        LocationStatus.MOCK_GPS_SUSPECTED,
    }
    trust_status = LocationTrustStatus(str(flags.get("trust_status") or LocationTrustStatus.NO_DATA.value))
    if trust_score != int(flags.get("trust_score") or 0):
        trust_status = trust_status_from_score(trust_score, suspicious=suspicious, has_location=lat is not None and lon is not None)
    location_event.location_status = location_status
    location_event.geofence_status = GeofenceStatus(geofence_status_value)
    location_event.trust_status = trust_status
    location_event.trust_score = trust_score
    location_event.distance_to_geofence_m = _coerce_float(flags.get("distance_to_geofence_m"))
    flags["trust_score"] = trust_score
    flags["trust_status"] = trust_status.value
    flags["device_changed"] = device_changed
    flags["provider_changed"] = provider_changed
    return flags


def _upsert_location_event(
    db: Session,
    *,
    existing: EmployeeLocationEvent | None,
    employee_id: int,
    device_id: int | None,
    attendance_event_id: int | None,
    audit_log_id: int | None,
    source: LocationEventSource,
    ts_utc: datetime,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    speed_mps: float | None = None,
    heading_deg: float | None = None,
    altitude_m: float | None = None,
    provider: str | None = None,
    ip: str | None = None,
    network_type: str | None = None,
    battery_level: float | None = None,
    is_mocked: bool | None = None,
    details: dict[str, Any] | None = None,
) -> EmployeeLocationEvent:
    location_event = existing or EmployeeLocationEvent(
        employee_id=employee_id,
        device_id=device_id,
        attendance_event_id=attendance_event_id,
        audit_log_id=audit_log_id,
        source=source,
        ts_utc=ts_utc,
    )
    if existing is None:
        db.add(location_event)

    location_event.employee_id = employee_id
    location_event.device_id = device_id
    location_event.attendance_event_id = attendance_event_id
    location_event.audit_log_id = audit_log_id
    location_event.source = source
    location_event.ts_utc = ts_utc
    location_event.lat = lat
    location_event.lon = lon
    location_event.accuracy_m = accuracy_m
    location_event.speed_mps = speed_mps
    location_event.heading_deg = heading_deg
    location_event.altitude_m = altitude_m
    location_event.provider = provider
    location_event.ip = ip
    location_event.network_type = network_type
    location_event.battery_level = battery_level
    location_event.is_mocked = is_mocked
    location_event.details = details or {}

    employee_location = _get_employee_home_location(db, employee_id)
    previous_event = _previous_location_event(
        db,
        employee_id=employee_id,
        before_ts_utc=ts_utc,
        exclude_event_id=location_event.id if location_event.id is not None else None,
    )
    evaluation_flags = _apply_location_evaluation(
        location_event=location_event,
        employee_location=employee_location,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        ts_utc=ts_utc,
        previous_event=previous_event,
        is_mocked=is_mocked,
    )
    location_event.details = {
        **(details or {}),
        "evaluation": evaluation_flags,
    }
    db.flush()
    return location_event


def sync_location_event_from_attendance_event(
    db: Session,
    event: AttendanceEvent,
    *,
    commit: bool = True,
) -> EmployeeLocationEvent:
    existing = db.scalar(
        select(EmployeeLocationEvent).where(EmployeeLocationEvent.attendance_event_id == event.id)
    )
    location_event = _upsert_location_event(
        db,
        existing=existing,
        employee_id=event.employee_id,
        device_id=event.device_id,
        attendance_event_id=event.id,
        audit_log_id=None,
        source=_attendance_type_to_location_source(event.type),
        ts_utc=_normalize_utc(event.ts_utc) or datetime.now(timezone.utc),
        lat=event.lat,
        lon=event.lon,
        accuracy_m=event.accuracy_m,
        details={
            "attendance_type": event.type.value,
            "attendance_source": event.source.value,
            "attendance_flags": event.flags or {},
            "created_by_admin": event.created_by_admin,
        },
    )
    if commit:
        db.commit()
        db.refresh(location_event)
    return location_event


def sync_location_event_from_audit_log(
    db: Session,
    log_item: AuditLog,
    *,
    commit: bool = True,
) -> EmployeeLocationEvent | None:
    if log_item.employee_id is None:
        return None
    details = log_item.details or {}
    lat = _coerce_float(details.get("lat"))
    lon = _coerce_float(details.get("lon"))
    existing = db.scalar(select(EmployeeLocationEvent).where(EmployeeLocationEvent.audit_log_id == log_item.id))
    location_event = _upsert_location_event(
        db,
        existing=existing,
        employee_id=log_item.employee_id,
        device_id=log_item.device_id,
        attendance_event_id=None,
        audit_log_id=log_item.id,
        source=_app_source_to_location_source(details.get("source"), log_item.event_type),
        ts_utc=_normalize_utc(log_item.ts_utc) or datetime.now(timezone.utc),
        lat=lat,
        lon=lon,
        accuracy_m=_coerce_float(details.get("accuracy_m")),
        speed_mps=_coerce_float(details.get("speed_mps")),
        heading_deg=_coerce_float(details.get("heading_deg")),
        altitude_m=_coerce_float(details.get("altitude_m")),
        provider=(str(details.get("provider")).strip()[:40] if details.get("provider") is not None else None),
        ip=log_item.ip,
        network_type=(str(details.get("network_type")).strip()[:40] if details.get("network_type") is not None else None),
        battery_level=_coerce_float(details.get("battery_level")),
        is_mocked=_coerce_bool(details.get("is_mocked")),
        details={
            "audit_module": log_item.module,
            "audit_event_type": log_item.event_type,
            "audit_action": log_item.action,
            "source": details.get("source"),
        },
    )
    if commit:
        db.commit()
        db.refresh(location_event)
    return location_event


def hydrate_location_events_for_range(
    db: Session,
    *,
    employee_id: int,
    start_utc: datetime,
    end_utc: datetime,
) -> None:
    attendance_rows = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee_id,
                AttendanceEvent.deleted_at.is_(None),
                AttendanceEvent.ts_utc >= start_utc,
                AttendanceEvent.ts_utc < end_utc,
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        ).all()
    )
    audit_rows = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.employee_id == employee_id,
                AuditLog.action == "EMPLOYEE_APP_LOCATION_PING",
                AuditLog.ts_utc >= start_utc,
                AuditLog.ts_utc < end_utc,
            )
            .order_by(AuditLog.ts_utc.asc(), AuditLog.id.asc())
        ).all()
    )
    changed = False
    for row in attendance_rows:
        sync_location_event_from_attendance_event(db, row, commit=False)
        changed = True
    for row in audit_rows:
        sync_location_event_from_audit_log(db, row, commit=False)
        changed = True
    if changed:
        db.commit()
