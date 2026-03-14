from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import Device, Employee, YabuBirdPresence, YabuBirdRoom, YabuBirdScore

LIVE_ROOM_MAX_AGE = timedelta(minutes=12)
LIVE_ROOM_STALE_WINDOW = timedelta(seconds=18)
LIVE_PLAYER_VISIBILITY_WINDOW = timedelta(seconds=35)
LEADERBOARD_SAMPLE_LIMIT = 250

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


def _room_to_read(room: YabuBirdRoom) -> dict[str, Any]:
    return {
        "id": room.id,
        "room_key": room.room_key,
        "seed": room.seed,
        "status": room.status,
        "started_at": room.started_at,
        "ended_at": room.ended_at,
        "created_at": room.created_at,
        "updated_at": room.updated_at,
    }


def _presence_to_read(presence: YabuBirdPresence) -> dict[str, Any]:
    employee_name = (
        presence.employee.full_name
        if presence.employee is not None and presence.employee.full_name
        else presence.display_name
    )
    return {
        "id": presence.id,
        "room_id": presence.room_id,
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
    return {
        "id": score.id,
        "employee_id": score.employee_id,
        "employee_name": employee_name,
        "score": score.score,
        "survived_ms": score.survived_ms,
        "room_id": score.room_id,
        "created_at": score.created_at,
    }


def _active_presence_count(db: Session, *, room_id: int, now: datetime) -> int:
    active_threshold = now - LIVE_ROOM_STALE_WINDOW
    count = db.scalar(
        select(func.count(YabuBirdPresence.id)).where(
            YabuBirdPresence.room_id == room_id,
            YabuBirdPresence.is_connected.is_(True),
            YabuBirdPresence.finished_at.is_(None),
            YabuBirdPresence.last_seen_at >= active_threshold,
        )
    )
    return int(count or 0)


def _close_room_if_idle(db: Session, *, room: YabuBirdRoom, now: datetime) -> None:
    if room.status != "OPEN":
        return
    if _active_presence_count(db, room_id=room.id, now=now) > 0:
        return
    room.status = "CLOSED"
    room.ended_at = room.ended_at or now


def _get_or_create_live_room(db: Session, *, now: datetime) -> YabuBirdRoom:
    open_rooms = list(
        db.scalars(
            select(YabuBirdRoom)
            .where(YabuBirdRoom.status == "OPEN")
            .order_by(YabuBirdRoom.started_at.desc(), YabuBirdRoom.id.desc())
            .limit(5)
        ).all()
    )

    for room in open_rooms:
        room_age = now - room.started_at
        if room_age > LIVE_ROOM_MAX_AGE:
            room.status = "CLOSED"
            room.ended_at = room.ended_at or now
            continue

        if _active_presence_count(db, room_id=room.id, now=now) > 0:
            return room

        room.status = "CLOSED"
        room.ended_at = room.ended_at or now

    room = YabuBirdRoom(
        room_key=f"global-live-{int(now.timestamp())}-{secrets.token_hex(3)}",
        seed=secrets.randbelow(2_000_000_000),
        status="OPEN",
        started_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(room)
    db.flush()
    return room


def _list_live_players(db: Session, *, room_id: int, now: datetime) -> list[dict[str, Any]]:
    visible_threshold = now - LIVE_PLAYER_VISIBILITY_WINDOW
    players = list(
        db.scalars(
            select(YabuBirdPresence)
            .options(selectinload(YabuBirdPresence.employee))
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
    return [_presence_to_read(item) for item in players]


def get_yabubird_leaderboard(db: Session, *, limit: int = 15) -> list[dict[str, Any]]:
    raw_scores = list(
        db.scalars(
            select(YabuBirdScore)
            .options(selectinload(YabuBirdScore.employee))
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


def get_yabubird_latest_scores(db: Session, *, limit: int = 20) -> list[dict[str, Any]]:
    latest_scores = list(
        db.scalars(
            select(YabuBirdScore)
            .options(selectinload(YabuBirdScore.employee))
            .order_by(YabuBirdScore.created_at.desc(), YabuBirdScore.id.desc())
            .limit(limit)
        ).all()
    )
    return [_score_to_read(item) for item in latest_scores]


def get_yabubird_personal_best(db: Session, *, employee_id: int) -> int:
    best_score = db.scalar(
        select(func.max(YabuBirdScore.score)).where(YabuBirdScore.employee_id == employee_id)
    )
    return int(best_score or 0)


def _build_live_state(db: Session, *, room: YabuBirdRoom, presence: YabuBirdPresence) -> dict[str, Any]:
    now = _utcnow()
    db.refresh(room)
    db.refresh(presence)
    return {
        "room": _room_to_read(room),
        "you": _presence_to_read(presence),
        "players": _list_live_players(db, room_id=room.id, now=now),
        "leaderboard": get_yabubird_leaderboard(db, limit=12),
        "personal_best": get_yabubird_personal_best(db, employee_id=presence.employee_id),
    }


def join_yabubird_live_room(db: Session, *, device_fingerprint: str) -> dict[str, Any]:
    now = _utcnow()
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    room = _get_or_create_live_room(db, now=now)
    presence = db.scalar(
        select(YabuBirdPresence)
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
        db.add(presence)
        db.flush()
    else:
        presence.display_name = employee.full_name
        presence.is_connected = True
        presence.last_seen_at = now

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
    presence.latest_score = max(int(score), 0)
    presence.last_seen_at = now
    presence.finished_at = presence.finished_at or now

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
    presence.last_seen_at = now
    if presence.room is not None:
        _close_room_if_idle(db, room=presence.room, now=now)
    db.commit()
    return build_employee_yabubird_overview(db, device_fingerprint=device_fingerprint)


def get_live_room_snapshot(db: Session) -> tuple[YabuBirdRoom | None, list[dict[str, Any]]]:
    now = _utcnow()
    room = db.scalar(
        select(YabuBirdRoom)
        .where(YabuBirdRoom.status == "OPEN")
        .order_by(YabuBirdRoom.started_at.desc(), YabuBirdRoom.id.desc())
    )
    if room is None:
        return None, []
    players = _list_live_players(db, room_id=room.id, now=now)
    if not players:
        _close_room_if_idle(db, room=room, now=now)
        db.commit()
        if room.status != "OPEN":
            return None, []
    return room, players


def build_employee_yabubird_overview(db: Session, *, device_fingerprint: str) -> dict[str, Any]:
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    employee = device.employee
    if employee is None:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    room, players = get_live_room_snapshot(db)
    return {
        "leaderboard": get_yabubird_leaderboard(db, limit=12),
        "live_room": _room_to_read(room) if room is not None else None,
        "live_players": players,
        "personal_best": get_yabubird_personal_best(db, employee_id=employee.id),
    }


def build_admin_yabubird_overview(db: Session) -> dict[str, Any]:
    room, players = get_live_room_snapshot(db)
    return {
        "live_room": _room_to_read(room) if room is not None else None,
        "live_players": players,
        "leaderboard": get_yabubird_leaderboard(db, limit=25),
        "latest_scores": get_yabubird_latest_scores(db, limit=25),
    }
