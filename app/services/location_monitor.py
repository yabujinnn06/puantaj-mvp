from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Employee,
    EmployeeLocation,
    EmployeeLocationEvent,
    GeofenceStatus,
    LocationEventSource,
    LocationStatus,
)
from app.schemas import (
    LocationMonitorDayRecordRead,
    LocationMonitorEmployeeSummaryRead,
    LocationMonitorEmployeeTimelineResponse,
    EmployeeRead,
    LocationMonitorGeofenceRead,
    LocationMonitorInsightRead,
    LocationMonitorMapPointRead,
    LocationMonitorMapResponse,
    LocationMonitorPrivacyRead,
    LocationMonitorRangeTotalsRead,
    LocationMonitorRepeatedPointRead,
    LocationMonitorRouteStatsRead,
    LocationMonitorSummaryResponse,
    LocationMonitorTimelineEventRead,
    LocationMonitorTimelineResponse,
)
from app.services.attendance import _attendance_timezone
from app.services.location import distance_m, location_status_needs_attention
from app.services.location_events import hydrate_location_events_for_range
from app.services.monthly import calculate_employee_monthly

logger = logging.getLogger(__name__)

MAP_POINT_SOURCES = {
    LocationEventSource.CHECKIN: "CHECKIN",
    LocationEventSource.CHECKOUT: "CHECKOUT",
    LocationEventSource.APP_OPEN: "APP_OPEN",
    LocationEventSource.APP_CLOSE: "APP_CLOSE",
    LocationEventSource.DEMO_START: "DEMO_START",
    LocationEventSource.DEMO_END: "DEMO_END",
    LocationEventSource.LOCATION_PING: "LOCATION_PING",
}
POINT_SOURCE_LABELS = {
    LocationEventSource.CHECKIN: "Mesai baslangici",
    LocationEventSource.CHECKOUT: "Mesai bitisi",
    LocationEventSource.APP_OPEN: "Uygulama girisi",
    LocationEventSource.APP_CLOSE: "Uygulama cikisi",
    LocationEventSource.DEMO_START: "Demo baslangici",
    LocationEventSource.DEMO_END: "Demo bitisi",
    LocationEventSource.LOCATION_PING: "Konum pingi",
}
DWELL_RADIUS_M = 22.0
DWELL_MINUTES_THRESHOLD = 8
SIMPLIFY_DISTANCE_M = 16.0
LOW_ACCURACY_THRESHOLD_M = 120.0
SUSPICIOUS_SPEED_THRESHOLD_MPS = 55.0


@dataclass(slots=True)
class LocationVisibilityPolicy:
    exact_coordinates: bool = True
    ip_visible: bool = True
    device_visible: bool = True


def _safe_location_status(value: Any) -> LocationStatus | None:
    if isinstance(value, LocationStatus):
        return value
    if value is None:
        return None
    try:
        return LocationStatus(str(value).strip().upper())
    except ValueError:
        return None


def _safe_geofence_status(value: Any) -> GeofenceStatus | None:
    if isinstance(value, GeofenceStatus):
        return value
    if value is None:
        return None
    try:
        return GeofenceStatus(str(value).strip().upper())
    except ValueError:
        return None


def _safe_trust_status(value: Any) -> Any:
    from app.models import LocationTrustStatus

    if isinstance(value, LocationTrustStatus):
        return value
    if value is None:
        return None
    try:
        return LocationTrustStatus(str(value).strip().upper())
    except ValueError:
        return None


def _safe_location_source(value: Any) -> LocationEventSource | None:
    if isinstance(value, LocationEventSource):
        return value
    if value is None:
        return None
    try:
        return LocationEventSource(str(value).strip().upper())
    except ValueError:
        return None


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in {float("inf"), float("-inf")}:
        return None
    return parsed


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_flags(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _local_day(value: datetime | None) -> date | None:
    normalized = _normalize_utc(value)
    if normalized is None:
        return None
    return normalized.astimezone(_attendance_timezone()).date()


def _mask_ip(value: str | None) -> str | None:
    if not value:
        return None
    if ":" in value:
        head = value.split(":")[:3]
        return ":".join(head + ["xxxx"])
    parts = value.split(".")
    if len(parts) == 4:
        return ".".join(parts[:2] + ["x", "x"])
    return value[:3] + "***"


def _apply_coordinate_visibility(value: float, *, exact: bool) -> float:
    return value if exact else round(value, 3)


def _has_valid_coordinates(event: EmployeeLocationEvent | None) -> bool:
    return event is not None and _safe_float(event.lat) is not None and _safe_float(event.lon) is not None


def _point_label(source: LocationEventSource) -> str:
    return POINT_SOURCE_LABELS.get(source, "Konum")


def _summary_point_source(source: LocationEventSource) -> str:
    return MAP_POINT_SOURCES.get(source, "LOCATION_PING")


def _event_to_map_point(
    event: EmployeeLocationEvent,
    *,
    visibility: LocationVisibilityPolicy,
    marker_kind: str = "EVENT",
) -> LocationMonitorMapPointRead | None:
    lat = _safe_float(event.lat)
    lon = _safe_float(event.lon)
    source = _safe_location_source(event.source)
    if lat is None or lon is None:
        return None
    if source is None:
        return None
    point_day = _local_day(event.ts_utc)
    if point_day is None:
        return None
    return LocationMonitorMapPointRead(
        id=f"location-event-{event.id}",
        day=point_day,
        source=_summary_point_source(source),  # type: ignore[arg-type]
        lat=_apply_coordinate_visibility(lat, exact=visibility.exact_coordinates),
        lon=_apply_coordinate_visibility(lon, exact=visibility.exact_coordinates),
        accuracy_m=_safe_float(event.accuracy_m),
        ts_utc=event.ts_utc,
        label=_point_label(source),
        location_status=_safe_location_status(event.location_status),
        device_id=event.device_id if visibility.device_visible else None,
        ip=event.ip if visibility.ip_visible else _mask_ip(event.ip),
        geofence_status=_safe_geofence_status(event.geofence_status),
        trust_status=_safe_trust_status(event.trust_status),
        trust_score=_safe_int(event.trust_score),
        provider=event.provider,
        speed_mps=_safe_float(event.speed_mps),
        heading_deg=_safe_float(event.heading_deg),
        altitude_m=_safe_float(event.altitude_m),
        is_mocked=event.is_mocked,
        battery_level=_safe_float(event.battery_level),
        network_type=event.network_type,
        marker_kind=marker_kind,  # type: ignore[arg-type]
    )


def _event_to_timeline_event(
    event: EmployeeLocationEvent,
    *,
    visibility: LocationVisibilityPolicy,
) -> LocationMonitorTimelineEventRead:
    lat = _safe_float(event.lat)
    lon = _safe_float(event.lon)
    source = _safe_location_source(event.source) or LocationEventSource.LOCATION_PING
    return LocationMonitorTimelineEventRead(
        id=f"location-event-{event.id}",
        ts_utc=event.ts_utc,
        day=_local_day(event.ts_utc) or event.ts_utc.astimezone(_attendance_timezone()).date(),
        source=source,
        label=_point_label(source),
        lat=_apply_coordinate_visibility(lat, exact=visibility.exact_coordinates) if lat is not None else None,
        lon=_apply_coordinate_visibility(lon, exact=visibility.exact_coordinates) if lon is not None else None,
        accuracy_m=_safe_float(event.accuracy_m),
        location_status=_safe_location_status(event.location_status),
        geofence_status=_safe_geofence_status(event.geofence_status),
        trust_status=_safe_trust_status(event.trust_status),
        trust_score=_safe_int(event.trust_score),
        device_id=event.device_id if visibility.device_visible else None,
        ip=event.ip if visibility.ip_visible else _mask_ip(event.ip),
        provider=event.provider,
        speed_mps=_safe_float(event.speed_mps),
        heading_deg=_safe_float(event.heading_deg),
        altitude_m=_safe_float(event.altitude_m),
        is_mocked=event.is_mocked,
        battery_level=_safe_float(event.battery_level),
        network_type=event.network_type,
        flags=_safe_flags(event.details),
    )


def _route_points(events: Iterable[EmployeeLocationEvent]) -> list[EmployeeLocationEvent]:
    return [
        event
        for event in events
        if _has_valid_coordinates(event) and _safe_location_source(event.source) is not None
    ]


def _movement_distance(points: list[EmployeeLocationEvent]) -> float:
    total = 0.0
    for previous, current in zip(points, points[1:]):
        previous_lat = _safe_float(previous.lat)
        previous_lon = _safe_float(previous.lon)
        current_lat = _safe_float(current.lat)
        current_lon = _safe_float(current.lon)
        if None in {previous_lat, previous_lon, current_lat, current_lon}:
            continue
        total += distance_m(previous_lat, previous_lon, current_lat, current_lon)
    return total


def _elapsed_minutes(start: datetime | None, end: datetime | None) -> int:
    if start is None or end is None or end <= start:
        return 0
    return max(0, int(round((end - start).total_seconds() / 60)))


def _repeated_groups(
    points: list[EmployeeLocationEvent],
    *,
    visibility: LocationVisibilityPolicy,
) -> list[LocationMonitorRepeatedPointRead]:
    if len(points) < 2:
        return []

    groups: list[LocationMonitorRepeatedPointRead] = []
    current_group: list[EmployeeLocationEvent] = [points[0]]

    def flush_group() -> None:
        nonlocal current_group
        if len(current_group) < 2:
            current_group = []
            return
        start_ts = current_group[0].ts_utc
        end_ts = current_group[-1].ts_utc
        dwell_minutes = _elapsed_minutes(start_ts, end_ts)
        if dwell_minutes < DWELL_MINUTES_THRESHOLD:
            current_group = []
            return
        valid_points = [
            (_safe_float(item.lat), _safe_float(item.lon))
            for item in current_group
            if _safe_float(item.lat) is not None and _safe_float(item.lon) is not None
        ]
        if not valid_points:
            current_group = []
            return
        avg_lat = sum(item[0] for item in valid_points if item[0] is not None) / len(valid_points)
        avg_lon = sum(item[1] for item in valid_points if item[1] is not None) / len(valid_points)
        groups.append(
            LocationMonitorRepeatedPointRead(
                id=f"dwell-{current_group[0].id}",
                lat=_apply_coordinate_visibility(avg_lat, exact=visibility.exact_coordinates),
                lon=_apply_coordinate_visibility(avg_lon, exact=visibility.exact_coordinates),
                point_count=len(current_group),
                dwell_minutes=dwell_minutes,
                label=f"Bekleme noktasi ({dwell_minutes} dk)",
            )
        )
        current_group = []

    for point in points[1:]:
        previous = current_group[-1]
        previous_lat = _safe_float(previous.lat)
        previous_lon = _safe_float(previous.lon)
        point_lat = _safe_float(point.lat)
        point_lon = _safe_float(point.lon)
        if None not in {previous_lat, previous_lon, point_lat, point_lon} and distance_m(previous_lat, previous_lon, point_lat, point_lon) <= DWELL_RADIUS_M:
            current_group.append(point)
            continue
        flush_group()
        current_group = [point]

    flush_group()
    return groups


def _simplify_points(points: list[EmployeeLocationEvent]) -> list[EmployeeLocationEvent]:
    if len(points) <= 2:
        return points
    simplified = [points[0]]
    last_kept = points[0]
    for point in points[1:-1]:
        must_keep = point.source in {
            LocationEventSource.CHECKIN,
            LocationEventSource.CHECKOUT,
            LocationEventSource.DEMO_START,
            LocationEventSource.DEMO_END,
        } or location_status_needs_attention(point.location_status)
        if must_keep:
            simplified.append(point)
            last_kept = point
            continue
        last_kept_lat = _safe_float(last_kept.lat)
        last_kept_lon = _safe_float(last_kept.lon)
        point_lat = _safe_float(point.lat)
        point_lon = _safe_float(point.lon)
        if None not in {last_kept_lat, last_kept_lon, point_lat, point_lon} and distance_m(last_kept_lat, last_kept_lon, point_lat, point_lon) >= SIMPLIFY_DISTANCE_M:
            simplified.append(point)
            last_kept = point
    simplified.append(points[-1])
    return simplified


def _suspicious_jump_count(points: list[EmployeeLocationEvent]) -> int:
    total = 0
    for previous, current in zip(points, points[1:]):
        previous_lat = _safe_float(previous.lat)
        previous_lon = _safe_float(previous.lon)
        current_lat = _safe_float(current.lat)
        current_lon = _safe_float(current.lon)
        if None in {previous_lat, previous_lon, current_lat, current_lon}:
            continue
        delta_seconds = max(1.0, (current.ts_utc - previous.ts_utc).total_seconds())
        speed_mps = distance_m(previous_lat, previous_lon, current_lat, current_lon) / delta_seconds
        if speed_mps > SUSPICIOUS_SPEED_THRESHOLD_MPS or current.location_status == LocationStatus.SUSPICIOUS_JUMP:
            total += 1
    return total


def _location_insights(
    *,
    events: list[EmployeeLocationEvent],
    day_records: list[LocationMonitorDayRecordRead],
    total_distance_m: float,
) -> list[LocationMonitorInsightRead]:
    insights: list[LocationMonitorInsightRead] = []
    if not events:
        return [
            LocationMonitorInsightRead(
                code="NO_LOCATION_EVENTS",
                severity="warning",
                title="Konum kaydi yok",
                message="Secilen aralikta normalize edilmis konum olayi bulunmuyor.",
            )
        ]

    low_accuracy_count = sum(1 for item in events if (_safe_float(item.accuracy_m) or 0) >= LOW_ACCURACY_THRESHOLD_M)
    outside_geofence_count = sum(1 for item in events if _safe_geofence_status(item.geofence_status) == GeofenceStatus.OUTSIDE)
    suspicious_jump_count = _suspicious_jump_count(_route_points(events))
    unique_devices = len({item.device_id for item in events if item.device_id is not None})
    demo_count = sum(
        1
        for item in events
        if _safe_location_source(item.source) in {LocationEventSource.DEMO_START, LocationEventSource.DEMO_END}
    )
    missing_location_attendance_days = sum(
        1 for item in day_records if (item.check_in or item.check_out) and item.last_location_point is None
    )

    insights.append(
        LocationMonitorInsightRead(
            code="DAILY_MOVEMENT_DISTANCE",
            severity="info",
            title="Toplam hareket",
            message=f"Secili aralikta yaklasik {round(total_distance_m / 1000, 2)} km iz olustu.",
            value=round(total_distance_m, 2),
        )
    )
    if outside_geofence_count > 0:
        insights.append(
            LocationMonitorInsightRead(
                code="GEOFENCE_VIOLATION",
                severity="warning",
                title="Geofence ihlali",
                message=f"Calisan {outside_geofence_count} kez tanimli alan disina cikmis gorunuyor.",
                value=outside_geofence_count,
            )
        )
    if low_accuracy_count > 0:
        ratio = round((low_accuracy_count / max(1, len(events))) * 100)
        insights.append(
            LocationMonitorInsightRead(
                code="LOW_ACCURACY_RATIO",
                severity="warning" if ratio >= 25 else "info",
                title="Dusuk dogruluk",
                message=f"Konum olaylarinin %{ratio} kadari dusuk dogrulukta.",
                value=ratio,
            )
        )
    if suspicious_jump_count > 0:
        insights.append(
            LocationMonitorInsightRead(
                code="SUSPICIOUS_JUMPS",
                severity="critical",
                title="Supheli sicrama",
                message=f"Rota icinde {suspicious_jump_count} adet imkansiz hiz/gecis tespit edildi.",
                value=suspicious_jump_count,
            )
        )
    if missing_location_attendance_days > 0:
        insights.append(
            LocationMonitorInsightRead(
                code="ATTENDANCE_LOCATION_GAP",
                severity="warning",
                title="Attendance-konum uyumsuzlugu",
                message=f"{missing_location_attendance_days} gunde attendance var ama konum izi yok.",
                value=missing_location_attendance_days,
            )
        )
    insights.append(
        LocationMonitorInsightRead(
            code="DEVICE_CONSISTENCY",
            severity="info" if unique_devices <= 1 else "warning",
            title="Cihaz tutarliligi",
            message=f"Secilen aralikta {unique_devices} farkli cihaz izi goruldu.",
            value=unique_devices,
        )
    )
    if demo_count > 0:
        insights.append(
            LocationMonitorInsightRead(
                code="DEMO_CORRELATION",
                severity="info",
                title="Demo hareketi",
                message=f"Secilen aralikta {demo_count} demo baglantili konum olayi kaydedildi.",
                value=demo_count,
            )
        )
    return insights


def _privacy_read(policy: LocationVisibilityPolicy) -> LocationMonitorPrivacyRead:
    return LocationMonitorPrivacyRead(
        exact_coordinates=policy.exact_coordinates,
        ip_visible=policy.ip_visible,
        device_visible=policy.device_visible,
    )


def _geofence_read(employee_location: EmployeeLocation | None, latest_event: EmployeeLocationEvent | None) -> LocationMonitorGeofenceRead | None:
    if employee_location is None and latest_event is None:
        return None
    status_value = (
        _safe_geofence_status(latest_event.geofence_status)
        if latest_event is not None and _safe_geofence_status(latest_event.geofence_status) is not None
        else (GeofenceStatus.NOT_CONFIGURED if employee_location is None else GeofenceStatus.UNKNOWN)
    )
    return LocationMonitorGeofenceRead(
        home_lat=employee_location.home_lat if employee_location is not None else None,
        home_lon=employee_location.home_lon if employee_location is not None else None,
        radius_m=employee_location.radius_m if employee_location is not None else None,
        status=status_value,
        distance_m=latest_event.distance_to_geofence_m if latest_event is not None else None,
    )


def _query_employee_location_events(
    db: Session,
    *,
    employee_id: int,
    start_utc: datetime,
    end_utc: datetime,
) -> list[EmployeeLocationEvent]:
    try:
        hydrate_location_events_for_range(db, employee_id=employee_id, start_utc=start_utc, end_utc=end_utc)
    except Exception:
        logger.exception(
            "location monitor hydration failed",
            extra={
                "employee_id": employee_id,
                "start_utc": start_utc.isoformat(),
                "end_utc": end_utc.isoformat(),
            },
        )
        db.rollback()
    try:
        return list(
            db.scalars(
                select(EmployeeLocationEvent)
                .options(
                    selectinload(EmployeeLocationEvent.attendance_event),
                    selectinload(EmployeeLocationEvent.audit_log),
                )
                .where(
                    EmployeeLocationEvent.employee_id == employee_id,
                    EmployeeLocationEvent.ts_utc >= start_utc,
                    EmployeeLocationEvent.ts_utc < end_utc,
                )
                .order_by(EmployeeLocationEvent.ts_utc.asc(), EmployeeLocationEvent.id.asc())
            ).all()
        )
    except Exception:
        logger.exception(
            "location monitor event query failed",
            extra={
                "employee_id": employee_id,
                "start_utc": start_utc.isoformat(),
                "end_utc": end_utc.isoformat(),
            },
        )
        db.rollback()
        return []


def _month_range_totals(
    db: Session,
    *,
    employee_id: int,
    start_date: date,
    end_date: date,
) -> tuple[dict[date, Any], LocationMonitorRangeTotalsRead, int, int]:
    tz = _attendance_timezone()
    now_local = datetime.now(timezone.utc).astimezone(tz)
    current_report = calculate_employee_monthly(db, employee_id=employee_id, year=now_local.year, month=now_local.month)
    worked_today_minutes = next((day.worked_minutes for day in current_report.days if day.date == now_local.date()), 0)
    week_start = now_local.date() - timedelta(days=now_local.date().weekday())
    week_end = week_start + timedelta(days=6)
    weekly_total_minutes = sum(day.worked_minutes for day in current_report.days if week_start <= day.date <= week_end)

    monthly_days_map: dict[date, Any] = {}
    totals = LocationMonitorRangeTotalsRead()
    cursor = date(start_date.year, start_date.month, 1)
    while cursor <= end_date:
        report = calculate_employee_monthly(db, employee_id=employee_id, year=cursor.year, month=cursor.month)
        for day_item in report.days:
            if not (start_date <= day_item.date <= end_date):
                continue
            monthly_days_map[day_item.date] = day_item
            totals.worked_minutes += day_item.worked_minutes
            totals.overtime_minutes += day_item.overtime_minutes
            totals.plan_overtime_minutes += day_item.plan_overtime_minutes
            totals.legal_overtime_minutes += day_item.legal_overtime_minutes
            if day_item.legal_overtime_minutes > 0 or day_item.overtime_minutes > 0:
                totals.overtime_day_count += 1
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return monthly_days_map, totals, worked_today_minutes, weekly_total_minutes


def _summary_from_events(
    *,
    employee: Employee,
    events: list[EmployeeLocationEvent],
    worked_today_minutes: int,
    weekly_total_minutes: int,
    visibility: LocationVisibilityPolicy,
) -> LocationMonitorEmployeeSummaryRead:
    latest_event = events[-1] if events else None
    latest_map_point = _event_to_map_point(latest_event, visibility=visibility, marker_kind="LAST") if latest_event else None
    last_by_source: dict[LocationEventSource, EmployeeLocationEvent] = {}
    for event in events:
        source = _safe_location_source(event.source)
        if source is not None:
            last_by_source[source] = event
    last_activity = max((event.ts_utc for event in events), default=None)
    today_events = [event for event in events if _local_day(event.ts_utc) == datetime.now(timezone.utc).astimezone(_attendance_timezone()).date()]
    has_checkin = any(_safe_location_source(event.source) == LocationEventSource.CHECKIN for event in today_events)
    has_checkout = any(_safe_location_source(event.source) == LocationEventSource.CHECKOUT for event in today_events)
    today_status = "IN_PROGRESS" if has_checkin and not has_checkout else ("FINISHED" if has_checkout else "NOT_STARTED")
    return LocationMonitorEmployeeSummaryRead(
        employee=EmployeeRead.model_validate(employee),
        department_name=employee.department.name if employee.department is not None else None,
        region_name=employee.region.name if employee.region is not None else None,
        shift_name=employee.shift.name if employee.shift is not None else None,
        today_status=today_status,  # type: ignore[arg-type]
        worked_today_minutes=worked_today_minutes,
        weekly_total_minutes=weekly_total_minutes,
        active_devices=sum(1 for item in list(employee.devices or []) if item.is_active),
        total_devices=len(list(employee.devices or [])),
        recent_ip=latest_event.ip if latest_event is not None and visibility.ip_visible else _mask_ip(latest_event.ip if latest_event else None),
        last_activity_utc=last_activity,
        last_portal_seen_utc=max(
            [
                item.ts_utc
                for item in events
                if _safe_location_source(item.source) in {LocationEventSource.APP_OPEN, LocationEventSource.APP_CLOSE}
            ],
            default=None,
        ),
        last_checkin_utc=last_by_source.get(LocationEventSource.CHECKIN).ts_utc if last_by_source.get(LocationEventSource.CHECKIN) else None,
        last_checkout_utc=last_by_source.get(LocationEventSource.CHECKOUT).ts_utc if last_by_source.get(LocationEventSource.CHECKOUT) else None,
        last_app_open_utc=last_by_source.get(LocationEventSource.APP_OPEN).ts_utc if last_by_source.get(LocationEventSource.APP_OPEN) else None,
        last_app_close_utc=last_by_source.get(LocationEventSource.APP_CLOSE).ts_utc if last_by_source.get(LocationEventSource.APP_CLOSE) else None,
        last_demo_start_utc=last_by_source.get(LocationEventSource.DEMO_START).ts_utc if last_by_source.get(LocationEventSource.DEMO_START) else None,
        last_demo_end_utc=last_by_source.get(LocationEventSource.DEMO_END).ts_utc if last_by_source.get(LocationEventSource.DEMO_END) else None,
        location_label=latest_map_point.label if latest_map_point is not None else None,
        latest_location=latest_map_point,
        last_location_status=_safe_location_status(latest_event.location_status) if latest_event is not None else None,
        last_geofence_status=_safe_geofence_status(latest_event.geofence_status) if latest_event is not None else None,
        last_trust_status=_safe_trust_status(latest_event.trust_status) if latest_event is not None else None,
        last_trust_score=latest_event.trust_score if latest_event is not None else None,
        last_accuracy_m=latest_event.accuracy_m if latest_event is not None else None,
        last_device_id=latest_event.device_id if latest_event is not None and visibility.device_visible else None,
        last_provider=latest_event.provider if latest_event is not None else None,
    )


def build_location_monitor_payloads(
    db: Session,
    *,
    employee_id: int,
    start_date: date,
    end_date: date,
    visibility: LocationVisibilityPolicy,
    source_filter: set[LocationEventSource] | None = None,
    bbox: tuple[float, float, float, float] | None = None,
    focus_day: date | None = None,
    latest_only: bool = False,
) -> tuple[LocationMonitorSummaryResponse, LocationMonitorTimelineResponse, LocationMonitorMapResponse, LocationMonitorEmployeeTimelineResponse]:
    employee = db.scalar(
        select(Employee)
        .options(selectinload(Employee.region), selectinload(Employee.department), selectinload(Employee.shift), selectinload(Employee.devices), selectinload(Employee.location))
        .where(Employee.id == employee_id)
    )
    if employee is None:
        raise ValueError("Employee not found")
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")

    tz = _attendance_timezone()
    now_utc = datetime.now(timezone.utc)
    start_utc = datetime.combine(start_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    end_utc = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    try:
        monthly_days_map, totals, worked_today_minutes, weekly_total_minutes = _month_range_totals(
            db,
            employee_id=employee_id,
            start_date=start_date,
            end_date=end_date,
        )
    except Exception:
        logger.exception(
            "location monitor monthly totals failed",
            extra={
                "employee_id": employee_id,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
        )
        monthly_days_map = {}
        totals = LocationMonitorRangeTotalsRead()
        worked_today_minutes = 0
        weekly_total_minutes = 0
    all_events = _query_employee_location_events(db, employee_id=employee_id, start_utc=start_utc, end_utc=end_utc)
    events = [event for event in all_events if event.attendance_event is None or event.attendance_event.deleted_at is None]
    route_events = _route_points(events)
    latest_event = events[-1] if events else None
    resolved_focus_day = focus_day
    if resolved_focus_day is None and latest_only:
        resolved_focus_day = max((_local_day(event.ts_utc) for event in events if _local_day(event.ts_utc) is not None), default=None)
    focus_day_events = [event for event in events if _local_day(event.ts_utc) == resolved_focus_day] if resolved_focus_day is not None else events

    if source_filter:
        events_for_map = [event for event in focus_day_events if event.source in source_filter]
    else:
        events_for_map = focus_day_events
    if bbox is not None:
        min_lon, min_lat, max_lon, max_lat = bbox
        events_for_map = [
            event
            for event in events_for_map
            if event.lat is not None
            and event.lon is not None
            and min_lat <= float(event.lat) <= max_lat
            and min_lon <= float(event.lon) <= max_lon
        ]
    route_events_for_map = _route_points(events_for_map)
    simplified_route = _simplify_points(route_events_for_map)
    repeated_groups = _repeated_groups(route_events_for_map, visibility=visibility)

    try:
        summary = _summary_from_events(
            employee=employee,
            events=events,
            worked_today_minutes=worked_today_minutes,
            weekly_total_minutes=weekly_total_minutes,
            visibility=visibility,
        )
    except Exception:
        logger.exception("location monitor summary build failed", extra={"employee_id": employee_id})
        summary = LocationMonitorEmployeeSummaryRead(
            employee=EmployeeRead.model_validate(employee),
            department_name=employee.department.name if employee.department is not None else None,
            region_name=employee.region.name if employee.region is not None else None,
            shift_name=employee.shift.name if employee.shift is not None else None,
            active_devices=sum(1 for item in list(employee.devices or []) if item.is_active),
            total_devices=len(list(employee.devices or [])),
        )

    day_events_map: dict[date, list[EmployeeLocationEvent]] = defaultdict(list)
    for event in events:
        day_key = _local_day(event.ts_utc)
        if day_key is not None:
            day_events_map[day_key].append(event)

    day_records: list[LocationMonitorDayRecordRead] = []
    for day_key in sorted(monthly_days_map.keys(), reverse=True):
        day_item = monthly_days_map[day_key]
        day_events = day_events_map.get(day_key, [])
        checkin = next((item for item in day_events if item.source == LocationEventSource.CHECKIN), None)
        checkout = next((item for item in reversed(day_events) if item.source == LocationEventSource.CHECKOUT), None)
        first_app_open = next((item for item in day_events if _safe_location_source(item.source) == LocationEventSource.APP_OPEN), None)
        last_app_close = next((item for item in reversed(day_events) if _safe_location_source(item.source) == LocationEventSource.APP_CLOSE), None)
        first_demo_start = next((item for item in day_events if _safe_location_source(item.source) == LocationEventSource.DEMO_START), None)
        last_demo_end = next((item for item in reversed(day_events) if _safe_location_source(item.source) == LocationEventSource.DEMO_END), None)
        last_location = next((item for item in reversed(day_events) if item.lat is not None and item.lon is not None), None)

        try:
            day_records.append(
                LocationMonitorDayRecordRead(
                    date=day_item.date,
                    status=day_item.status,
                    check_in=day_item.check_in,
                    check_out=day_item.check_out,
                    worked_minutes=day_item.worked_minutes,
                    overtime_minutes=day_item.overtime_minutes,
                    plan_overtime_minutes=day_item.plan_overtime_minutes,
                    legal_overtime_minutes=day_item.legal_overtime_minutes,
                    first_app_open_utc=first_app_open.ts_utc if first_app_open is not None else None,
                    last_app_close_utc=last_app_close.ts_utc if last_app_close is not None else None,
                    first_demo_start_utc=first_demo_start.ts_utc if first_demo_start is not None else None,
                    last_demo_end_utc=last_demo_end.ts_utc if last_demo_end is not None else None,
                    check_in_point=_event_to_map_point(checkin, visibility=visibility, marker_kind="START") if checkin else None,
                    check_out_point=_event_to_map_point(checkout, visibility=visibility, marker_kind="END") if checkout else None,
                    first_app_open_point=_event_to_map_point(first_app_open, visibility=visibility) if first_app_open else None,
                    last_app_close_point=_event_to_map_point(last_app_close, visibility=visibility) if last_app_close else None,
                    first_demo_start_point=_event_to_map_point(first_demo_start, visibility=visibility) if first_demo_start else None,
                    last_demo_end_point=_event_to_map_point(last_demo_end, visibility=visibility) if last_demo_end else None,
                    last_location_point=_event_to_map_point(last_location, visibility=visibility, marker_kind="LAST") if last_location else None,
                    suspicious_jump_count=sum(1 for item in day_events if _safe_location_status(item.location_status) == LocationStatus.SUSPICIOUS_JUMP),
                    low_accuracy_count=sum(1 for item in day_events if _safe_location_status(item.location_status) == LocationStatus.LOW_ACCURACY),
                    outside_geofence_count=sum(1 for item in day_events if _safe_geofence_status(item.geofence_status) == GeofenceStatus.OUTSIDE),
                    event_count=len(day_events),
                )
            )
        except Exception:
            logger.exception(
                "location monitor day record build failed",
                extra={"employee_id": employee_id, "day": day_key.isoformat()},
            )

    total_distance_m = _movement_distance(route_events)
    visible_distance_m = _movement_distance(route_events_for_map)
    route_stats = LocationMonitorRouteStatsRead(
        total_distance_m=round(visible_distance_m, 2),
        total_duration_minutes=(
            _elapsed_minutes(route_events_for_map[0].ts_utc, route_events_for_map[-1].ts_utc)
            if route_events_for_map
            else 0
        ),
        event_count=len(route_events_for_map),
        simplified_point_count=len(simplified_route),
        repeated_group_count=len(repeated_groups),
        suspicious_jump_count=_suspicious_jump_count(route_events_for_map),
        low_accuracy_event_count=sum(1 for item in events_for_map if (_safe_float(item.accuracy_m) or 0) >= LOW_ACCURACY_THRESHOLD_M),
        dwell_stop_count=len(repeated_groups),
    )
    insights = _location_insights(events=events, day_records=day_records, total_distance_m=total_distance_m)
    geofence = _geofence_read(employee.location, latest_event)
    privacy = _privacy_read(visibility)

    map_points = []
    for event in route_events_for_map:
        try:
            map_points.append(
                _event_to_map_point(
                    event,
                    visibility=visibility,
                    marker_kind="JUMP" if _safe_location_status(event.location_status) == LocationStatus.SUSPICIOUS_JUMP else "EVENT",
                )
            )
        except Exception:
            logger.exception("location monitor map point build failed", extra={"employee_id": employee_id, "event_id": event.id})
    map_points = [item for item in map_points if item is not None]
    if map_points:
        map_points[0].marker_kind = "START"
        last_route_event = route_events_for_map[-1] if route_events_for_map else None
        map_points[-1].marker_kind = (
            "LAST" if latest_event is not None and last_route_event is not None and last_route_event.id == latest_event.id else "END"
        )

    simplified_map_points = []
    for event in simplified_route:
        try:
            simplified_map_points.append(
                _event_to_map_point(
                    event,
                    visibility=visibility,
                    marker_kind="JUMP" if _safe_location_status(event.location_status) == LocationStatus.SUSPICIOUS_JUMP else "EVENT",
                )
            )
        except Exception:
            logger.exception("location monitor simplified point build failed", extra={"employee_id": employee_id, "event_id": event.id})
    simplified_map_points = [item for item in simplified_map_points if item is not None]
    if simplified_map_points:
        simplified_map_points[0].marker_kind = "START"
        simplified_map_points[-1].marker_kind = (
            "LAST" if latest_event is not None and simplified_route and simplified_route[-1].id == latest_event.id else "END"
        )

    timeline_events = []
    for event in focus_day_events:
        try:
            timeline_events.append(_event_to_timeline_event(event, visibility=visibility))
        except Exception:
            logger.exception("location monitor timeline event build failed", extra={"employee_id": employee_id, "event_id": event.id})

    summary_response = LocationMonitorSummaryResponse(
        generated_at_utc=now_utc,
        summary=summary,
        insights=insights,
        geofence=geofence,
        privacy=privacy,
    )
    timeline_response = LocationMonitorTimelineResponse(
        generated_at_utc=now_utc,
        start_date=start_date,
        end_date=end_date,
        days=day_records,
        events=timeline_events,
        insights=insights,
        totals=totals,
    )
    map_response = LocationMonitorMapResponse(
        generated_at_utc=now_utc,
        start_date=start_date,
        end_date=end_date,
        points=map_points,
        simplified_points=simplified_map_points,
        repeated_groups=repeated_groups,
        route_stats=route_stats,
        geofence=geofence,
        privacy=privacy,
    )
    legacy_response = LocationMonitorEmployeeTimelineResponse(
        generated_at_utc=now_utc,
        start_date=start_date,
        end_date=end_date,
        summary=summary,
        totals=totals,
        days=day_records,
        map_points=map_points,
        simplified_map_points=simplified_map_points,
        timeline_events=timeline_events,
        insights=insights,
        route_stats=route_stats,
        repeated_groups=repeated_groups,
        geofence=geofence,
        privacy=privacy,
    )
    return summary_response, timeline_response, map_response, legacy_response
