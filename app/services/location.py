from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt

from app.models import EmployeeLocation, GeofenceStatus, LocationStatus, LocationTrustStatus

STALE_LOCATION_WINDOW = timedelta(minutes=20)
LOW_ACCURACY_THRESHOLD_M = 120.0
VERY_LOW_ACCURACY_THRESHOLD_M = 250.0
SUSPICIOUS_SPEED_THRESHOLD_MPS = 55.0
MOCK_GPS_SCORE_PENALTY = 55
LOW_ACCURACY_SCORE_PENALTY = 24
STALE_SCORE_PENALTY = 20
OUTSIDE_GEOFENCE_SCORE_PENALTY = 18
SUSPICIOUS_JUMP_SCORE_PENALTY = 34


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6371000.0

    lat1_rad = radians(lat1)
    lon1_rad = radians(lon1)
    lat2_rad = radians(lat2)
    lon2_rad = radians(lon2)

    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad

    a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return earth_radius_m * c


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return distance_m(lat1, lon1, lat2, lon2)


def trust_status_from_score(score: int, *, suspicious: bool = False, has_location: bool = True) -> LocationTrustStatus:
    if not has_location:
        return LocationTrustStatus.NO_DATA
    if suspicious:
        return LocationTrustStatus.SUSPICIOUS
    if score >= 85:
        return LocationTrustStatus.HIGH
    if score >= 60:
        return LocationTrustStatus.MEDIUM
    return LocationTrustStatus.LOW


def geofence_status_for_point(
    employee_location: EmployeeLocation | None,
    lat: float | None,
    lon: float | None,
) -> tuple[GeofenceStatus, float | None]:
    if lat is None or lon is None:
        return GeofenceStatus.UNKNOWN, None
    if employee_location is None:
        return GeofenceStatus.NOT_CONFIGURED, None

    distance_to_home_m = distance_m(lat, lon, employee_location.home_lat, employee_location.home_lon)
    if distance_to_home_m <= float(employee_location.radius_m):
        return GeofenceStatus.INSIDE, distance_to_home_m
    return GeofenceStatus.OUTSIDE, distance_to_home_m


def location_status_needs_attention(status: LocationStatus | None) -> bool:
    return status in {
        LocationStatus.UNVERIFIED_LOCATION,
        LocationStatus.LOW_ACCURACY,
        LocationStatus.STALE_LOCATION,
        LocationStatus.OUTSIDE_GEOFENCE,
        LocationStatus.SUSPICIOUS_JUMP,
        LocationStatus.MOCK_GPS_SUSPECTED,
        LocationStatus.NO_LOCATION,
    }


def location_status_is_verified(status: LocationStatus | None) -> bool:
    return status in {
        LocationStatus.VERIFIED_HOME,
        LocationStatus.INSIDE_GEOFENCE,
        LocationStatus.VERIFIED,
    }


def evaluate_location(
    employee_location: EmployeeLocation | None,
    lat: float | None,
    lon: float | None,
    *,
    accuracy_m: float | None = None,
    captured_at_utc: datetime | None = None,
    previous_lat: float | None = None,
    previous_lon: float | None = None,
    previous_ts_utc: datetime | None = None,
    is_mocked: bool | None = None,
) -> tuple[LocationStatus, dict[str, float | int | str | bool | None]]:
    if lat is None or lon is None:
        return LocationStatus.NO_LOCATION, {
            "reason": "no_location_payload",
            "trust_score": 0,
            "trust_status": LocationTrustStatus.NO_DATA.value,
            "geofence_status": GeofenceStatus.UNKNOWN.value,
        }

    score = 100
    suspicious = False
    reason = "verified"
    geofence_status, distance_to_geofence_m = geofence_status_for_point(employee_location, lat, lon)
    normalized_captured_at = _normalize_utc(captured_at_utc)
    normalized_previous_ts = _normalize_utc(previous_ts_utc)

    impossible_speed_mps: float | None = None
    if (
        previous_lat is not None
        and previous_lon is not None
        and normalized_captured_at is not None
        and normalized_previous_ts is not None
        and normalized_captured_at > normalized_previous_ts
    ):
        hop_distance_m = distance_m(previous_lat, previous_lon, lat, lon)
        hop_seconds = max(1.0, (normalized_captured_at - normalized_previous_ts).total_seconds())
        impossible_speed_mps = hop_distance_m / hop_seconds
        if impossible_speed_mps > SUSPICIOUS_SPEED_THRESHOLD_MPS:
            score -= SUSPICIOUS_JUMP_SCORE_PENALTY
            suspicious = True
            reason = "suspicious_jump"

    if is_mocked is True:
        score -= MOCK_GPS_SCORE_PENALTY
        suspicious = True
        reason = "mock_gps_suspected"

    if accuracy_m is not None:
        if accuracy_m >= VERY_LOW_ACCURACY_THRESHOLD_M:
            score -= LOW_ACCURACY_SCORE_PENALTY + 12
            reason = "low_accuracy"
        elif accuracy_m >= LOW_ACCURACY_THRESHOLD_M:
            score -= LOW_ACCURACY_SCORE_PENALTY
            reason = "low_accuracy"

    if normalized_captured_at is not None:
        age_seconds = max(0.0, (datetime.now(timezone.utc) - normalized_captured_at).total_seconds())
        if age_seconds > STALE_LOCATION_WINDOW.total_seconds():
            score -= STALE_SCORE_PENALTY
            reason = "stale_location"
    else:
        age_seconds = None

    if geofence_status == GeofenceStatus.OUTSIDE:
        score -= OUTSIDE_GEOFENCE_SCORE_PENALTY
        if reason == "verified":
            reason = "outside_geofence"

    score = max(0, min(100, int(round(score))))
    trust_status = trust_status_from_score(score, suspicious=suspicious, has_location=True)

    if is_mocked is True:
        location_status = LocationStatus.MOCK_GPS_SUSPECTED
    elif suspicious:
        location_status = LocationStatus.SUSPICIOUS_JUMP
    elif accuracy_m is not None and accuracy_m >= LOW_ACCURACY_THRESHOLD_M:
        location_status = LocationStatus.LOW_ACCURACY
    elif age_seconds is not None and age_seconds > STALE_LOCATION_WINDOW.total_seconds():
        location_status = LocationStatus.STALE_LOCATION
    elif geofence_status == GeofenceStatus.OUTSIDE:
        location_status = LocationStatus.OUTSIDE_GEOFENCE
    elif geofence_status == GeofenceStatus.INSIDE:
        location_status = LocationStatus.INSIDE_GEOFENCE
    elif employee_location is None:
        location_status = LocationStatus.VERIFIED
    else:
        location_status = LocationStatus.VERIFIED_HOME

    return location_status, {
        "reason": reason,
        "trust_score": score,
        "trust_status": trust_status.value,
        "geofence_status": geofence_status.value,
        "distance_to_geofence_m": (round(distance_to_geofence_m, 2) if distance_to_geofence_m is not None else None),
        "is_mocked": bool(is_mocked) if is_mocked is not None else None,
        "accuracy_m": accuracy_m,
        "event_age_seconds": (round(age_seconds, 2) if age_seconds is not None else None),
        "impossible_speed_mps": (round(impossible_speed_mps, 2) if impossible_speed_mps is not None else None),
    }
