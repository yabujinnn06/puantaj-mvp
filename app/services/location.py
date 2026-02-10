from math import asin, cos, radians, sin, sqrt

from app.models import EmployeeLocation, LocationStatus


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
    # Backward-compatible alias. New code should use distance_m.
    return distance_m(lat1, lon1, lat2, lon2)


def evaluate_location(
    employee_location: EmployeeLocation | None,
    lat: float | None,
    lon: float | None,
) -> tuple[LocationStatus, dict[str, float | int | str]]:
    if lat is None or lon is None:
        return LocationStatus.NO_LOCATION, {"reason": "no_location_payload"}

    if employee_location is None:
        return LocationStatus.UNVERIFIED_LOCATION, {"reason": "home_location_not_set"}

    distance_value = distance_m(
        employee_location.home_lat,
        employee_location.home_lon,
        lat,
        lon,
    )
    flags = {
        "distance_m": round(distance_value, 2),
        "radius_m": employee_location.radius_m,
    }

    if distance_value <= employee_location.radius_m:
        return LocationStatus.VERIFIED_HOME, flags

    return LocationStatus.UNVERIFIED_LOCATION, flags

