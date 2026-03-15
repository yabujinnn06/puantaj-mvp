from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import Device


@dataclass(frozen=True, slots=True)
class ChessActorContext:
    employee_id: int
    device_id: int
    device_fingerprint: str
    display_name: str


def resolve_chess_actor(db: Session, *, device_fingerprint: str) -> ChessActorContext:
    device = db.scalar(
        select(Device)
        .options(selectinload(Device.employee))
        .where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise ApiError(status_code=404, code="DEVICE_NOT_FOUND", message="Cihaz oturumu bulunamadi.")
    employee = device.employee
    if employee is None or not employee.is_active:
        raise ApiError(status_code=403, code="EMPLOYEE_NOT_ACTIVE", message="Calisan satranc modulu kullanamiyor.")
    return ChessActorContext(
        employee_id=int(employee.id),
        device_id=int(device.id),
        device_fingerprint=device.device_fingerprint,
        display_name=(employee.full_name or f"Calisan {employee.id}").strip(),
    )

