from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
import string
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import AuditActorType, AuditLog, Device, Employee, YabuBirdPresence, YabuBirdRoom, YabuBirdScore

RoomType = Literal["PUBLIC", "PARTY", "SOLO"]
JoinMode = Literal["PUBLIC", "HOST", "ROOM", "SOLO"]

PUBLIC_ROOM_PREFIX = "public-live"
PARTY_ROOM_PREFIX = "party"
SOLO_ROOM_PREFIX = "solo"

LIVE_ROOM_MAX_AGE = timedelta(minutes=12)
PARTY_ROOM_MAX_AGE = timedelta(minutes=40)
SOLO_ROOM_MAX_AGE = timedelta(minutes=20)
LIVE_PLAYER_VISIBILITY_WINDOW = timedelta(seconds=35)
LIVE_PLAYER_ACTIVITY_WINDOW = timedelta(seconds=18)
LOCATION_LIVE_WINDOW = timedelta(seconds=45)
LOCATION_STALE_WINDOW = timedelta(minutes=12)
LEADERBOARD_SAMPLE_LIMIT = 250
APP_ENTRY_AUDIT_ACTION = "EMPLOYEE_APP_LOCATION_PING"

PLAYER_COLORS = (
    "#67d3ff",
    "#8ef2ff",
    "#9cd4ff",
    "#9bf7d6",
    "#ffe58f",
    "#c4b5fd",
    "#fda4af",
    "#fdba74",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _room_type_from_key(room_key: str | None) -> tuple[RoomType | None, str | None]:
    normalized = (room_key or "").strip()
    if not normalized:
        return None, None
    if normalized.startswith(f"{PUBLIC_ROOM_PREFIX}-"):
        return "PUBLIC", None
    if normalized.startswith(f"{PARTY_ROOM_PREFIX}-"):
        parts = normalized.split("-")
        share_code = parts[1].upper() if len(parts) >= 2 else None
        return "PARTY", share_code
    if normalized.startswith(f"{SOLO_ROOM_PREFIX}-"):
        return "SOLO", None
    return "PUBLIC", None


def _room_max_age(room_type: RoomType) -> timedelta:
    if room_type == "PARTY":
        return PARTY_ROOM_MAX_AGE
    if room_type == "SOLO":
        return SOLO_ROOM_MAX_AGE
    return LIVE_ROOM_MAX_AGE


def _room_label(room_type: RoomType | None, share_code: str | None) -> str | None:
    if room_type == "PARTY":
        return f"Server {share_code}" if share_code else "Server"
    if room_type == "SOLO":
        return "Tek Oyun"
    if room_type == "PUBLIC":
        return "Beraber Oyna"
    return None


def _room_to_read(room: YabuBirdRoom, *, player_count: int = 0) -> dict[str, Any]:
    room_type, share_code = _room_type_from_key(room.room_key)
    if room_type is None:
        room_type = "PUBLIC"
    return {
        "id": room.id,
        "room_key": room.room_key,
        "room_type": room_type,
        "room_label": _room_label(room_type, share_code) or "YabuBird",
        "share_code": share_code,
        "seed": room.seed,
        "status": room.status,
        "player_count": max(0, int(player_count)),
        "started_at": room.started_at,
        "ended_at": room.ended_at,
        "created_at": room.created_at,
        "updated_at": room.updated_at,
    }


def _resolve_active_device(db: Session, *, device_fingerprint: str) -> Device:
    device = db.scalar(
        select(Device)
        .options(selectinload(Device.employee))
        .where(
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
            message="Inactive employee cannot use YabuBird.",
        )
    return device


def _presence_color(employee_id: int) -> str:
    return PLAYER_COLORS[employee_id % len(PLAYER_COLORS)]


def _presence_to_read(presence: YabuBirdPresence) -> dict[str, Any]:
    employee_name = (
        presence.employee.full_name
        if presence.employee is not None and presence.employee.full_name
        else presence.display_name
    )
    room_key = presence.room.room_key if presence.room is not None else None
    room_type, share_code = _room_type_from_key(room_key)
    return {
        "id": presence.id,
        "room_id": presence.room_id,
        "room_key": room_key,
        "room_type": room_type,
        "room_label": _room_label(room_type, share_code),
        "share_code": share_code,
        "employee_id": presence.employee_id,
        "employee_name": employee_name,
        "color_hex": presence.color_hex,
        "is_connected": presence.is_connected,
        "is_alive": presence.is_alive,
        "latest_score": presence.latest_score,
        "latest_y": presence.latest_y,
        "latest_velocity": presence.latest_velocity,
        "flap_count": presence.flap_count,
        "started_at": presence.started_at,
        "last_seen_at": presence.last_seen_at,
        "finished_at": presence.finished_at,
    }


def _score_to_read(score: YabuBirdScore) -> dict[str, Any]:
    employee_name = (
        score.employee.full_name
        if score.employee is not None and score.employee.full_name
        else score.display_name_snapshot
    )
    room = score.room
    if room is None and score.presence is not None:
        room = score.presence.room
    room_key = room.room_key if room is not None else None
    room_type, share_code = _room_type_from_key(room_key)
    return {
        "id": score.id,
        "employee_id": score.employee_id,
        "employee_name": employee_name,
        "score": score.score,
        "survived_ms": score.survived_ms,
        "room_id": score.room_id,
        "room_key": room_key,
        "room_type": room_type,
        "room_label": _room_label(room_type, share_code),
        "share_code": share_code,
        "created_at": score.created_at,
    }


def _location_state(location_at: datetime | None, *, now: datetime) -> Literal["LIVE", "STALE", "DORMANT", "NONE"]:
    if location_at is None:
        return "NONE"
    age = now - location_at
    if age <= LOCATION_LIVE_WINDOW:
        return "LIVE"
    if age <= LOCATION_STALE_WINDOW:
        return "STALE"
    return "DORMANT"


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            return float(normalized)
        except ValueError:
            return None
    return None


def _presence_location_to_read(
    presence: YabuBirdPresence,
    *,
    now: datetime,
) -> dict[str, Any] | None:
    if (
        presence.latest_lat is None
        or presence.latest_lon is None
        or presence.latest_location_at is None
    ):
        return None

    room_key = presence.room.room_key if presence.room is not None else None
    room_type, share_code = _room_type_from_key(room_key)
    employee_name = (
        presence.employee.full_name
        if presence.employee is not None and presence.employee.full_name
        else presence.display_name
    )
    return {
        "presence_id": presence.id,
        "score_id": None,
        "employee_id": presence.employee_id,
        "employee_name": employee_name,
        "room_id": presence.room_id,
        "room_key": room_key,
        "room_type": room_type,
        "room_label": _room_label(room_type, share_code),
        "share_code": share_code,
        "score": max(0, int(presence.latest_score)),
        "survived_ms": None,
        "is_connected": presence.is_connected,
        "is_alive": presence.is_alive,
        "location_state": _location_state(presence.latest_location_at, now=now),
        "played_at": presence.started_at,
        "last_seen_at": presence.last_seen_at,
        "location": {
            "lat": float(presence.latest_lat),
            "lon": float(presence.latest_lon),
            "accuracy_m": presence.latest_accuracy_m,
            "ts_utc": presence.latest_location_at,
        },
    }


def _score_location_to_read(score: YabuBirdScore, *, now: datetime) -> dict[str, Any] | None:
    presence = score.presence
    if (
        presence is None
        or presence.latest_lat is None
        or presence.latest_lon is None
        or presence.latest_location_at is None
    ):
        return None

    room = score.room
    if room is None and presence.room is not None:
        room = presence.room
    room_key = room.room_key if room is not None else None
    room_type, share_code = _room_type_from_key(room_key)
    employee_name = (
        score.employee.full_name
        if score.employee is not None and score.employee.full_name
        else score.display_name_snapshot
    )
    return {
        "presence_id": presence.id,
        "score_id": score.id,
        "employee_id": score.employee_id,
        "employee_name": employee_name,
        "room_id": score.room_id,
        "room_key": room_key,
        "room_type": room_type,
        "room_label": _room_label(room_type, share_code),
        "share_code": share_code,
        "score": max(0, int(score.score)),
        "survived_ms": max(0, int(score.survived_ms)),
        "is_connected": presence.is_connected,
        "is_alive": presence.is_alive,
        "location_state": _location_state(presence.latest_location_at, now=now),
        "played_at": score.created_at,
        "last_seen_at": presence.last_seen_at,
        "location": {
            "lat": float(presence.latest_lat),
            "lon": float(presence.latest_lon),
            "accuracy_m": presence.latest_accuracy_m,
            "ts_utc": presence.latest_location_at,
        },
    }


def _apply_presence_location(
    presence: YabuBirdPresence,
    *,
    lat: float | None,
    lon: float | None,
    accuracy_m: float | None,
    now: datetime,
) -> None:
    if lat is None or lon is None:
        return
    presence.latest_lat = float(lat)
    presence.latest_lon = float(lon)
    presence.latest_accuracy_m = float(accuracy_m) if accuracy_m is not None else None
    presence.latest_location_at = now


def _normalize_room_code(value: str | None) -> str | None:
    normalized = "".join(
        ch for ch in (value or "").strip().upper() if ch in string.ascii_uppercase + string.digits
    )
    if 4 <= len(normalized) <= 12:
        return normalized
    return None


def _generate_party_code(db: Session) -> str:
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(12):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        existing = db.scalar(
            select(YabuBirdRoom.id).where(
                YabuBirdRoom.status == "OPEN",
                YabuBirdRoom.room_key.like(f"{PARTY_ROOM_PREFIX}-{code}-%"),
            )
        )
        if existing is None:
            return code
    raise ApiError(status_code=500, code="YABUBIRD_ROOM_CODE_FAILED", message="Room code could not be created.")


def _create_room(
    db: Session,
    *,
    room_type: RoomType,
    now: datetime,
    employee_id: int,
) -> YabuBirdRoom:
    if room_type == "PARTY":
        share_code = _generate_party_code(db)
        room_key = f"{PARTY_ROOM_PREFIX}-{share_code}-{int(now.timestamp())}-{secrets.token_hex(2)}"
    elif room_type == "SOLO":
        room_key = f"{SOLO_ROOM_PREFIX}-{employee_id}-{int(now.timestamp())}-{secrets.token_hex(2)}"
    else:
        room_key = f"{PUBLIC_ROOM_PREFIX}-{int(now.timestamp())}-{secrets.token_hex(3)}"

    room = YabuBirdRoom(
        room_key=room_key,
        seed=secrets.randbelow(2_000_000_000),
        status="OPEN",
        started_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(room)
    db.flush()
    return room


def _list_room_presences(db: Session, *, room_id: int, now: datetime) -> list[YabuBirdPresence]:
    visible_threshold = now - LIVE_PLAYER_VISIBILITY_WINDOW
    return list(
        db.scalars(
            select(YabuBirdPresence)
            .options(selectinload(YabuBirdPresence.employee), selectinload(YabuBirdPresence.room))
            .where(
                YabuBirdPresence.room_id == room_id,
                YabuBirdPresence.last_seen_at >= visible_threshold,
            )
            .order_by(
                YabuBirdPresence.latest_score.desc(),
                YabuBirdPresence.last_seen_at.desc(),
                YabuBirdPresence.id.asc(),
            )
        ).all()
    )


def _room_has_active_players(players: list[YabuBirdPresence], *, now: datetime) -> bool:
    active_threshold = now - LIVE_PLAYER_ACTIVITY_WINDOW
    return any(
        player.is_connected
        and player.finished_at is None
        and player.last_seen_at >= active_threshold
        for player in players
    )


def _close_room(room: YabuBirdRoom, *, now: datetime) -> None:
    room.status = "CLOSED"
    room.ended_at = room.ended_at or now


def _close_room_if_idle(db: Session, *, room: YabuBirdRoom, now: datetime) -> None:
    room_type, _ = _room_type_from_key(room.room_key)
    room_type = room_type or "PUBLIC"
    if room_type == "PARTY":
        return
    players = _list_room_presences(db, room_id=room.id, now=now)
    if _room_has_active_players(players, now=now):
        return
    _close_room(room, now=now)


def get_live_rooms_snapshot(db: Session) -> tuple[list[YabuBirdRoom], dict[int, list[YabuBirdPresence]]]:
    now = _utcnow()
    mutated = False
    live_rooms: list[YabuBirdRoom] = []
    players_by_room_id: dict[int, list[YabuBirdPresence]] = {}

    rooms = list(
        db.scalars(
            select(YabuBirdRoom)
            .where(YabuBirdRoom.status == "OPEN")
            .order_by(YabuBirdRoom.started_at.desc(), YabuBirdRoom.id.desc())
        ).all()
    )

    for room in rooms:
        room_type, _ = _room_type_from_key(room.room_key)
        room_type = room_type or "PUBLIC"
        if now - room.started_at > _room_max_age(room_type):
            _close_room(room, now=now)
            mutated = True
            continue

        players = _list_room_presences(db, room_id=room.id, now=now)
        if room_type in {"PUBLIC", "SOLO"} and not _room_has_active_players(players, now=now):
            _close_room(room, now=now)
            mutated = True
            continue

        live_rooms.append(room)
        players_by_room_id[room.id] = players

    if mutated:
        db.commit()

    return live_rooms, players_by_room_id


def _get_or_create_public_room(db: Session, *, now: datetime, employee_id: int) -> YabuBirdRoom:
    rooms, _ = get_live_rooms_snapshot(db)
    for room in rooms:
        room_type, _ = _room_type_from_key(room.room_key)
        if room_type == "PUBLIC":
            return room
    room = _create_room(db, room_type="PUBLIC", now=now, employee_id=employee_id)
    db.flush()
    return room


def _resolve_party_room_by_code(db: Session, *, room_code: str, now: datetime) -> YabuBirdRoom:
    normalized_room_code = _normalize_room_code(room_code)
    if normalized_room_code is None:
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message="Room code is invalid.")

    room = db.scalar(
        select(YabuBirdRoom)
        .where(
            YabuBirdRoom.status == "OPEN",
            YabuBirdRoom.room_key.like(f"{PARTY_ROOM_PREFIX}-{normalized_room_code}-%"),
        )
        .order_by(YabuBirdRoom.started_at.desc(), YabuBirdRoom.id.desc())
    )
    if room is None:
        raise ApiError(status_code=404, code="YABUBIRD_ROOM_NOT_FOUND", message="Requested room was not found.")

    room_type, _ = _room_type_from_key(room.room_key)
    room_type = room_type or "PARTY"
    if now - room.started_at > _room_max_age(room_type):
        _close_room(room, now=now)
        db.commit()
        raise ApiError(status_code=404, code="YABUBIRD_ROOM_NOT_FOUND", message="Requested room was not found.")

    return room


def _resolve_room_for_join(
    db: Session,
    *,
    join_mode: JoinMode,
    room_code: str | None,
    now: datetime,
    employee_id: int,
) -> YabuBirdRoom:
    if join_mode == "HOST":
        return _create_room(db, room_type="PARTY", now=now, employee_id=employee_id)
    if join_mode == "ROOM":
        return _resolve_party_room_by_code(db, room_code=room_code or "", now=now)
    if join_mode == "SOLO":
        return _create_room(db, room_type="SOLO", now=now, employee_id=employee_id)
    return _get_or_create_public_room(db, now=now, employee_id=employee_id)


def get_yabubird_leaderboard(db: Session, *, limit: int = 15) -> list[dict[str, Any]]:
    raw_scores = list(
        db.scalars(
            select(YabuBirdScore)
            .options(
                selectinload(YabuBirdScore.employee),
                selectinload(YabuBirdScore.room),
                selectinload(YabuBirdScore.presence),
            )
            .order_by(YabuBirdScore.score.desc(), YabuBirdScore.created_at.asc(), YabuBirdScore.id.asc())
            .limit(max(limit * 12, LEADERBOARD_SAMPLE_LIMIT))
        ).all()
    )

    leaderboard: list[dict[str, Any]] = []
    seen_employees: set[int] = set()
    for score in raw_scores:
        if score.employee_id in seen_employees:
            continue
        seen_employees.add(score.employee_id)
        leaderboard.append(_score_to_read(score))
        if len(leaderboard) >= limit:
            break
    return leaderboard


def get_yabubird_latest_score_rows(db: Session, *, limit: int = 20) -> list[YabuBirdScore]:
    return list(
        db.scalars(
            select(YabuBirdScore)
            .options(
                selectinload(YabuBirdScore.employee),
                selectinload(YabuBirdScore.room),
                selectinload(YabuBirdScore.presence).selectinload(YabuBirdPresence.room),
            )
            .order_by(YabuBirdScore.created_at.desc(), YabuBirdScore.id.desc())
            .limit(limit)
        ).all()
    )


def get_yabubird_latest_scores(db: Session, *, limit: int = 20) -> list[dict[str, Any]]:
    return [_score_to_read(item) for item in get_yabubird_latest_score_rows(db, limit=limit)]


def get_yabubird_personal_best(db: Session, *, employee_id: int) -> int:
    best_score = db.scalar(
        select(func.max(YabuBirdScore.score)).where(YabuBirdScore.employee_id == employee_id)
    )
    return int(best_score or 0)


def _build_live_state(db: Session, *, room: YabuBirdRoom, presence: YabuBirdPresence) -> dict[str, Any]:
    now = _utcnow()
    db.refresh(room)
    db.refresh(presence)
    room_players = _list_room_presences(db, room_id=room.id, now=now)
    return {
        "room": _room_to_read(room, player_count=len(room_players)),
        "you": _presence_to_read(presence),
        "players": [_presence_to_read(item) for item in room_players],
        "leaderboard": get_yabubird_leaderboard(db, limit=12),
        "personal_best": get_yabubird_personal_best(db, employee_id=presence.employee_id),
    }


def join_yabubird_live_room(
    db: Session,
    *,
    device_fingerprint: str,
    join_mode: JoinMode = "PUBLIC",
    room_code: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    accuracy_m: float | None = None,
) -> dict[str, Any]:
    now = _utcnow()
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    room = _resolve_room_for_join(
        db,
        join_mode=join_mode,
        room_code=room_code,
        now=now,
        employee_id=employee.id,
    )
    presence = db.scalar(
        select(YabuBirdPresence)
        .options(selectinload(YabuBirdPresence.room), selectinload(YabuBirdPresence.employee))
        .where(
            YabuBirdPresence.room_id == room.id,
            YabuBirdPresence.employee_id == employee.id,
            YabuBirdPresence.device_id == device.id,
            YabuBirdPresence.finished_at.is_(None),
        )
        .order_by(YabuBirdPresence.started_at.desc(), YabuBirdPresence.id.desc())
    )
    if presence is None:
        presence = YabuBirdPresence(
            room_id=room.id,
            employee_id=employee.id,
            device_id=device.id,
            display_name=employee.full_name,
            color_hex=_presence_color(employee.id),
            is_connected=True,
            is_alive=True,
            latest_score=0,
            latest_y=0.0,
            latest_velocity=0.0,
            flap_count=0,
            started_at=now,
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        _apply_presence_location(presence, lat=lat, lon=lon, accuracy_m=accuracy_m, now=now)
        db.add(presence)
        db.flush()
    else:
        presence.display_name = employee.full_name
        presence.is_connected = True
        presence.is_alive = True
        presence.last_seen_at = now
        presence.finished_at = None
        _apply_presence_location(presence, lat=lat, lon=lon, accuracy_m=accuracy_m, now=now)

    db.commit()
    return _build_live_state(db, room=room, presence=presence)


def update_yabubird_presence_state(
    db: Session,
    *,
    device_fingerprint: str,
    room_id: int,
    presence_id: int,
    y: float,
    velocity: float,
    score: int,
    flap_count: int,
    is_alive: bool,
    lat: float | None = None,
    lon: float | None = None,
    accuracy_m: float | None = None,
) -> dict[str, Any]:
    now = _utcnow()
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    presence = db.scalar(
        select(YabuBirdPresence)
        .options(selectinload(YabuBirdPresence.room), selectinload(YabuBirdPresence.employee))
        .where(
            YabuBirdPresence.id == presence_id,
            YabuBirdPresence.room_id == room_id,
            YabuBirdPresence.employee_id == employee.id,
            YabuBirdPresence.device_id == device.id,
        )
    )
    if presence is None or presence.room is None:
        raise ApiError(status_code=404, code="YABUBIRD_PRESENCE_NOT_FOUND", message="Live YabuBird run not found.")
    if presence.room.status != "OPEN":
        raise ApiError(status_code=409, code="YABUBIRD_ROOM_CLOSED", message="Live room is closed.")

    presence.display_name = employee.full_name
    presence.is_connected = True
    presence.is_alive = is_alive
    presence.latest_score = max(int(score), 0)
    presence.latest_y = float(y)
    presence.latest_velocity = float(velocity)
    presence.flap_count = max(int(flap_count), 0)
    presence.last_seen_at = now
    if not is_alive and presence.finished_at is None:
        presence.finished_at = now
    _apply_presence_location(presence, lat=lat, lon=lon, accuracy_m=accuracy_m, now=now)

    db.commit()
    return _build_live_state(db, room=presence.room, presence=presence)


def finish_yabubird_run(
    db: Session,
    *,
    device_fingerprint: str,
    room_id: int,
    presence_id: int,
    score: int,
    survived_ms: int,
    lat: float | None = None,
    lon: float | None = None,
    accuracy_m: float | None = None,
) -> dict[str, Any]:
    now = _utcnow()
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    presence = db.scalar(
        select(YabuBirdPresence)
        .options(selectinload(YabuBirdPresence.room), selectinload(YabuBirdPresence.employee))
        .where(
            YabuBirdPresence.id == presence_id,
            YabuBirdPresence.room_id == room_id,
            YabuBirdPresence.employee_id == employee.id,
            YabuBirdPresence.device_id == device.id,
        )
    )
    if presence is None:
        raise ApiError(status_code=404, code="YABUBIRD_PRESENCE_NOT_FOUND", message="Live YabuBird run not found.")

    presence.is_connected = False
    presence.is_alive = False
    presence.latest_score = max(int(score), 0)
    presence.last_seen_at = now
    presence.finished_at = presence.finished_at or now
    _apply_presence_location(presence, lat=lat, lon=lon, accuracy_m=accuracy_m, now=now)

    score_entry = db.scalar(
        select(YabuBirdScore)
        .where(YabuBirdScore.presence_id == presence.id)
        .order_by(YabuBirdScore.id.desc())
    )
    if score_entry is None:
        score_entry = YabuBirdScore(
            presence_id=presence.id,
            room_id=presence.room_id,
            employee_id=employee.id,
            device_id=device.id,
            score=max(int(score), 0),
            survived_ms=max(int(survived_ms), 0),
            display_name_snapshot=employee.full_name,
            created_at=now,
        )
        db.add(score_entry)
    else:
        score_entry.score = max(score_entry.score, max(int(score), 0))
        score_entry.survived_ms = max(score_entry.survived_ms, max(int(survived_ms), 0))
        score_entry.display_name_snapshot = employee.full_name

    if presence.room is not None:
        _close_room_if_idle(db, room=presence.room, now=now)

    db.commit()
    return build_employee_yabubird_overview(db, device_fingerprint=device_fingerprint)


def leave_yabubird_live_room(
    db: Session,
    *,
    device_fingerprint: str,
    room_id: int,
    presence_id: int,
    lat: float | None = None,
    lon: float | None = None,
    accuracy_m: float | None = None,
) -> dict[str, Any]:
    now = _utcnow()
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    presence = db.scalar(
        select(YabuBirdPresence)
        .options(selectinload(YabuBirdPresence.room))
        .where(
            YabuBirdPresence.id == presence_id,
            YabuBirdPresence.room_id == room_id,
            YabuBirdPresence.employee_id == employee.id,
            YabuBirdPresence.device_id == device.id,
        )
    )
    if presence is None:
        raise ApiError(status_code=404, code="YABUBIRD_PRESENCE_NOT_FOUND", message="Live YabuBird run not found.")

    presence.is_connected = False
    presence.is_alive = False
    presence.last_seen_at = now
    presence.finished_at = presence.finished_at or now
    _apply_presence_location(presence, lat=lat, lon=lon, accuracy_m=accuracy_m, now=now)
    if presence.room is not None:
        _close_room_if_idle(db, room=presence.room, now=now)
    db.commit()
    return build_employee_yabubird_overview(db, device_fingerprint=device_fingerprint)


def build_employee_yabubird_overview(db: Session, *, device_fingerprint: str) -> dict[str, Any]:
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    rooms, players_by_room_id = get_live_rooms_snapshot(db)
    public_room = next(
        (room for room in rooms if _room_type_from_key(room.room_key)[0] == "PUBLIC"),
        None,
    )
    public_players = players_by_room_id.get(public_room.id, []) if public_room is not None else []

    return {
        "leaderboard": get_yabubird_leaderboard(db, limit=12),
        "live_room": (
            _room_to_read(public_room, player_count=len(public_players))
            if public_room is not None
            else None
        ),
        "live_rooms": (
            [_room_to_read(public_room, player_count=len(public_players))]
            if public_room is not None
            else []
        ),
        "live_players": [_presence_to_read(item) for item in public_players],
        "personal_best": get_yabubird_personal_best(db, employee_id=employee.id),
    }


def build_admin_yabubird_overview(db: Session) -> dict[str, Any]:
    now = _utcnow()
    rooms, players_by_room_id = get_live_rooms_snapshot(db)
    room_reads = [
        _room_to_read(room, player_count=len(players_by_room_id.get(room.id, [])))
        for room in rooms
    ]
    latest_scores_rows = get_yabubird_latest_score_rows(db, limit=25)

    live_players = [
        _presence_to_read(player)
        for room in rooms
        for player in players_by_room_id.get(room.id, [])
    ]
    live_players.sort(key=lambda item: (-item["latest_score"], item["employee_name"], item["id"]))

    live_player_locations = [
        location_entry
        for room in rooms
        for player in players_by_room_id.get(room.id, [])
        for location_entry in [_presence_location_to_read(player, now=now)]
        if location_entry is not None
    ]
    live_player_locations.sort(
        key=lambda item: (
            0 if item["location_state"] == "LIVE" else 1,
            -item["score"],
            item["employee_name"],
        )
    )

    recent_player_locations = [
        location_entry
        for score in latest_scores_rows
        for location_entry in [_score_location_to_read(score, now=now)]
        if location_entry is not None
    ]

    app_entry_logs = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.actor_type == AuditActorType.SYSTEM,
                AuditLog.action == APP_ENTRY_AUDIT_ACTION,
                AuditLog.success.is_(True),
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(72)
        ).all()
    )
    employee_ids = sorted(
        {
            int(item.actor_id)
            for item in app_entry_logs
            if str(item.actor_id or "").strip().isdigit()
        }
    )
    employees_by_id = {
        row.id: row
        for row in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    } if employee_ids else {}
    app_entry_locations: list[dict[str, Any]] = []
    for log_item in app_entry_logs:
        actor_id_raw = str(log_item.actor_id or "").strip()
        if not actor_id_raw.isdigit():
            continue
        employee_id = int(actor_id_raw)
        details = log_item.details if isinstance(log_item.details, dict) else {}
        lat = _coerce_float(details.get("lat"))
        lon = _coerce_float(details.get("lon"))
        if lat is None or lon is None:
            continue
        accuracy_m = _coerce_float(details.get("accuracy_m"))
        employee_name = employees_by_id.get(employee_id).full_name if employee_id in employees_by_id else f"Calisan {employee_id}"
        app_entry_locations.append(
            {
                "audit_id": log_item.id,
                "employee_id": employee_id,
                "employee_name": employee_name,
                "source": str(details.get("source") or "APP_OPEN"),
                "location_state": _location_state(log_item.ts_utc, now=now),
                "logged_at": log_item.ts_utc,
                "location": {
                    "lat": lat,
                    "lon": lon,
                    "accuracy_m": accuracy_m,
                    "ts_utc": log_item.ts_utc,
                },
            }
        )

    return {
        "live_room": room_reads[0] if room_reads else None,
        "live_rooms": room_reads,
        "live_players": live_players,
        "leaderboard": get_yabubird_leaderboard(db, limit=25),
        "latest_scores": [_score_to_read(item) for item in latest_scores_rows],
        "live_player_locations": live_player_locations[:25],
        "recent_player_locations": recent_player_locations[:25],
        "app_entry_locations": app_entry_locations,
    }
