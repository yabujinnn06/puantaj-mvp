from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
import string
from typing import Any, Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import (
    AuditActorType,
    AuditLog,
    Device,
    Employee,
    YabuBirdPresence,
    YabuBirdReaction,
    YabuBirdRoom,
    YabuBirdScore,
)
from app.services.activity_events import (
    APP_ACTIVITY_EVENTS,
    EVENT_APP_LOGIN,
    EVENT_EMOJI_REACTION,
    EVENT_GAME_LOGIN,
    EVENT_GAME_LOGOUT,
    EVENT_GAME_SCORE_UPDATE,
    EVENT_GAME_SESSION_END,
    EVENT_GAME_SESSION_START,
    GAME_ACTIVITY_EVENTS,
    MODULE_APP,
    MODULE_GAME,
    YABUBIRD_REACTION_EMOJIS,
)

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
LEGACY_GAME_JOIN_AUDIT_ACTION = "YABUBIRD_JOINED"
LEGACY_GAME_FINISH_AUDIT_ACTION = "YABUBIRD_FINISHED"
LEGACY_GAME_LEAVE_AUDIT_ACTION = "YABUBIRD_LEFT"
REACTION_RECENT_WINDOW = timedelta(seconds=10)
REACTION_RATE_LIMIT_WINDOW = timedelta(milliseconds=900)
REACTION_RATE_LIMIT_BURST_WINDOW = timedelta(seconds=20)
REACTION_RATE_LIMIT_BURST_COUNT = 12
PARTY_ROOM_CAPACITY = 2

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


def _reaction_to_read(reaction: YabuBirdReaction) -> dict[str, Any]:
    employee_name = (
        reaction.employee.full_name
        if reaction.employee is not None and reaction.employee.full_name
        else f"Calisan {reaction.employee_id}"
    )
    return {
        "id": reaction.id,
        "room_id": reaction.room_id,
        "presence_id": reaction.presence_id,
        "employee_id": reaction.employee_id,
        "employee_name": employee_name,
        "emoji": reaction.emoji,
        "created_at": reaction.created_at,
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
    owner_employee_id: int | None = None,
    owner_device_id: int | None = None,
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
        owner_employee_id=owner_employee_id,
        owner_device_id=owner_device_id,
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


def _room_owner_is_active(room: YabuBirdRoom, *, players: list[YabuBirdPresence], now: datetime) -> bool:
    if room.owner_employee_id is None:
        return _room_has_active_players(players, now=now)
    active_threshold = now - LIVE_PLAYER_ACTIVITY_WINDOW
    for player in players:
        if player.employee_id != room.owner_employee_id:
            continue
        if room.owner_device_id is not None and player.device_id != room.owner_device_id:
            continue
        if not player.is_connected or player.finished_at is not None:
            continue
        if player.last_seen_at < active_threshold:
            continue
        return True
    return False


def _active_player_count(players: list[YabuBirdPresence], *, now: datetime) -> int:
    active_threshold = now - LIVE_PLAYER_ACTIVITY_WINDOW
    return sum(
        1
        for player in players
        if player.is_connected and player.finished_at is None and player.last_seen_at >= active_threshold
    )


def _close_room(room: YabuBirdRoom, *, now: datetime) -> None:
    room.status = "CLOSED"
    room.ended_at = room.ended_at or now


def _close_room_if_idle(db: Session, *, room: YabuBirdRoom, now: datetime) -> None:
    room_type, _ = _room_type_from_key(room.room_key)
    room_type = room_type or "PUBLIC"
    players = _list_room_presences(db, room_id=room.id, now=now)
    if room_type == "PARTY":
        if _room_owner_is_active(room, players=players, now=now) and _room_has_active_players(players, now=now):
            return
        _close_room(room, now=now)
        return
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
        if room_type == "PARTY":
            if not _room_owner_is_active(room, players=players, now=now) or not _room_has_active_players(players, now=now):
                _close_room(room, now=now)
                mutated = True
                continue
        elif not _room_has_active_players(players, now=now):
            _close_room(room, now=now)
            mutated = True
            continue

        live_rooms.append(room)
        players_by_room_id[room.id] = players

    if mutated:
        db.commit()

    return live_rooms, players_by_room_id


def _get_or_create_public_room(db: Session, *, now: datetime, employee_id: int, device_id: int) -> YabuBirdRoom:
    rooms, _ = get_live_rooms_snapshot(db)
    for room in rooms:
        room_type, _ = _room_type_from_key(room.room_key)
        if room_type == "PUBLIC":
            return room
    room = _create_room(
        db,
        room_type="PUBLIC",
        now=now,
        employee_id=employee_id,
        owner_employee_id=employee_id,
        owner_device_id=device_id,
    )
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

    players = _list_room_presences(db, room_id=room.id, now=now)
    if not _room_owner_is_active(room, players=players, now=now):
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
    device_id: int,
) -> YabuBirdRoom:
    if join_mode == "HOST":
        return _create_room(
            db,
            room_type="PARTY",
            now=now,
            employee_id=employee_id,
            owner_employee_id=employee_id,
            owner_device_id=device_id,
        )
    if join_mode == "ROOM":
        return _resolve_party_room_by_code(db, room_code=room_code or "", now=now)
    if join_mode == "SOLO":
        return _create_room(
            db,
            room_type="SOLO",
            now=now,
            employee_id=employee_id,
            owner_employee_id=employee_id,
            owner_device_id=device_id,
        )
    return _get_or_create_public_room(db, now=now, employee_id=employee_id, device_id=device_id)


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


def _list_room_reactions(db: Session, *, room_id: int, now: datetime) -> list[YabuBirdReaction]:
    reaction_threshold = now - REACTION_RECENT_WINDOW
    return list(
        reversed(
            list(
                db.scalars(
                    select(YabuBirdReaction)
                    .options(selectinload(YabuBirdReaction.employee))
                    .where(
                        YabuBirdReaction.room_id == room_id,
                        YabuBirdReaction.created_at >= reaction_threshold,
                    )
                    .order_by(YabuBirdReaction.created_at.desc(), YabuBirdReaction.id.desc())
                    .limit(18)
                ).all()
            )
        )
    )


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
        "reactions": [_reaction_to_read(item) for item in _list_room_reactions(db, room_id=room.id, now=now)],
        "personal_best": get_yabubird_personal_best(db, employee_id=presence.employee_id),
    }


def _close_other_active_presences(
    db: Session,
    *,
    employee_id: int,
    device_id: int,
    keep_room_id: int,
    now: datetime,
) -> None:
    active_presences = list(
        db.scalars(
            select(YabuBirdPresence)
            .options(selectinload(YabuBirdPresence.room))
            .where(
                YabuBirdPresence.employee_id == employee_id,
                YabuBirdPresence.device_id == device_id,
                YabuBirdPresence.finished_at.is_(None),
                YabuBirdPresence.room_id != keep_room_id,
            )
            .order_by(YabuBirdPresence.started_at.desc(), YabuBirdPresence.id.desc())
        ).all()
    )
    for active_presence in active_presences:
        active_presence.is_connected = False
        active_presence.is_alive = False
        active_presence.last_seen_at = now
        active_presence.finished_at = active_presence.finished_at or now
        if active_presence.room is not None:
            _close_room_if_idle(db, room=active_presence.room, now=now)


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
        device_id=device.id,
    )
    _close_other_active_presences(
        db,
        employee_id=employee.id,
        device_id=device.id,
        keep_room_id=room.id,
        now=now,
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
    room_type, _ = _room_type_from_key(room.room_key)
    if presence is None and room_type == "PARTY":
        active_players = _list_room_presences(db, room_id=room.id, now=now)
        if _active_player_count(active_players, now=now) >= PARTY_ROOM_CAPACITY:
            raise ApiError(status_code=409, code="YABUBIRD_ROOM_FULL", message="Requested room is full.")
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


def react_yabubird_live_room(
    db: Session,
    *,
    device_fingerprint: str,
    room_id: int,
    presence_id: int,
    emoji: str,
) -> dict[str, Any]:
    now = _utcnow()
    normalized_emoji = (emoji or "").strip()
    if normalized_emoji not in YABUBIRD_REACTION_EMOJIS:
        raise ApiError(status_code=422, code="YABUBIRD_REACTION_INVALID", message="Reaction is not allowed.")

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

    last_reaction = db.scalar(
        select(YabuBirdReaction)
        .where(
            YabuBirdReaction.room_id == room_id,
            YabuBirdReaction.employee_id == employee.id,
            YabuBirdReaction.device_id == device.id,
        )
        .order_by(YabuBirdReaction.created_at.desc(), YabuBirdReaction.id.desc())
    )
    if last_reaction is not None and now - last_reaction.created_at < REACTION_RATE_LIMIT_WINDOW:
        raise ApiError(status_code=429, code="YABUBIRD_REACTION_RATE_LIMIT", message="Reaction is cooling down.")

    burst_count = int(
        db.scalar(
            select(func.count(YabuBirdReaction.id)).where(
                YabuBirdReaction.room_id == room_id,
                YabuBirdReaction.employee_id == employee.id,
                YabuBirdReaction.created_at >= now - REACTION_RATE_LIMIT_BURST_WINDOW,
            )
        )
        or 0
    )
    if burst_count >= REACTION_RATE_LIMIT_BURST_COUNT:
        raise ApiError(status_code=429, code="YABUBIRD_REACTION_RATE_LIMIT", message="Reaction limit reached.")

    db.add(
        YabuBirdReaction(
            room_id=room_id,
            presence_id=presence.id,
            employee_id=employee.id,
            device_id=device.id,
            emoji=normalized_emoji,
            created_at=now,
        )
    )
    db.commit()
    return _build_live_state(db, room=presence.room, presence=presence)


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
    menu_rooms = [
        _room_to_read(room, player_count=len(players_by_room_id.get(room.id, [])))
        for room in rooms
        if _room_type_from_key(room.room_key)[0] != "SOLO"
    ]

    return {
        "leaderboard": get_yabubird_leaderboard(db, limit=12),
        "live_room": (
            _room_to_read(public_room, player_count=len(public_players))
            if public_room is not None
            else None
        ),
        "live_rooms": menu_rooms,
        "live_players": [_presence_to_read(item) for item in public_players],
        "personal_best": get_yabubird_personal_best(db, employee_id=employee.id),
    }


def _audit_employee_id(log_item: AuditLog) -> int | None:
    if log_item.employee_id is not None:
        return int(log_item.employee_id)
    actor_id_raw = str(log_item.actor_id or "").strip()
    if actor_id_raw.isdigit():
        return int(actor_id_raw)
    return None


def _build_activity_summary(log_item: AuditLog) -> str:
    event_type = (log_item.event_type or "").strip().lower()
    details = log_item.details if isinstance(log_item.details, dict) else {}
    if event_type == EVENT_APP_LOGIN:
        return f"Uygulamaya giris / {details.get('source') or 'APP_OPEN'}"
    if event_type == EVENT_GAME_LOGIN:
        return "YabuBird acildi"
    if event_type == EVENT_GAME_SESSION_START:
        room_label = details.get("room_label") or details.get("room_key") or "oda"
        return f"Oyun oturumu basladi / {room_label}"
    if event_type == EVENT_GAME_SESSION_END:
        score = details.get("score")
        return f"Oyun oturumu bitti / skor {score if score is not None else '-'}"
    if event_type == EVENT_GAME_LOGOUT:
        return "YabuBird odasindan cikildi"
    if event_type == EVENT_GAME_SCORE_UPDATE:
        score = details.get("score")
        return f"Skor guncellendi / {score if score is not None else '-'}"
    if event_type == EVENT_EMOJI_REACTION:
        return f"Emoji tepkisi / {details.get('emoji') or '-'}"
    return log_item.action


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
                AuditLog.success.is_(True),
                or_(
                    AuditLog.event_type == EVENT_APP_LOGIN,
                    AuditLog.action == APP_ENTRY_AUDIT_ACTION,
                ),
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(72)
        ).all()
    )
    recent_activity_logs = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.actor_type == AuditActorType.SYSTEM,
                AuditLog.success.is_(True),
                or_(
                    AuditLog.module.in_((MODULE_APP, MODULE_GAME)),
                    AuditLog.action.in_(
                        (
                            APP_ENTRY_AUDIT_ACTION,
                            LEGACY_GAME_JOIN_AUDIT_ACTION,
                            LEGACY_GAME_FINISH_AUDIT_ACTION,
                            LEGACY_GAME_LEAVE_AUDIT_ACTION,
                        )
                    ),
                ),
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(80)
        ).all()
    )
    employee_ids = sorted(
        {
            employee_id
            for item in [*app_entry_logs, *recent_activity_logs]
            for employee_id in [_audit_employee_id(item)]
            if employee_id is not None
        }
    )
    employees_by_id = {
        row.id: row
        for row in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    } if employee_ids else {}
    app_entry_locations: list[dict[str, Any]] = []
    for log_item in app_entry_logs:
        employee_id = _audit_employee_id(log_item)
        if employee_id is None:
            continue
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

    recent_activity: list[dict[str, Any]] = []
    for log_item in recent_activity_logs:
        employee_id = _audit_employee_id(log_item)
        employee_name = (
            employees_by_id[employee_id].full_name
            if employee_id is not None and employee_id in employees_by_id
            else None
        )
        details = log_item.details if isinstance(log_item.details, dict) else {}
        recent_activity.append(
            {
                "audit_id": log_item.id,
                "module": log_item.module,
                "event_type": log_item.event_type,
                "action": log_item.action,
                "employee_id": employee_id,
                "employee_name": employee_name,
                "device_id": log_item.device_id,
                "entity_type": log_item.entity_type,
                "entity_id": log_item.entity_id,
                "logged_at": log_item.ts_utc,
                "summary": _build_activity_summary(log_item),
                "details": details,
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
        "recent_activity": recent_activity,
    }
