from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.models import AttendanceType, Device, Employee, LocationStatus
from app.services.attendance import create_checkin_event, create_checkout_event


class _DummyDB:
    def __init__(self) -> None:
        self.added: list[object] = []

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        return

    def refresh(self, _obj: object) -> None:
        return


def _build_device(employee_id: int = 1) -> Device:
    employee = Employee(id=employee_id, full_name="Seq Test", department_id=None, is_active=True)
    device = Device(id=77, employee_id=employee_id, device_fingerprint="seq-fp", is_active=True)
    device.employee = employee
    return device


class AttendanceSequenceTests(unittest.TestCase):
    def test_checkin_is_allowed_after_finished_cycle_same_day(self) -> None:
        db = _DummyDB()
        device = _build_device()
        finished_last_event = SimpleNamespace(type=AttendanceType.OUT)

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_latest_event_for_employee", return_value=finished_last_event),
            patch("app.services.attendance.evaluate_location", return_value=(LocationStatus.NO_LOCATION, {})),
            patch("app.services.attendance.resolve_effective_plan_for_employee_day", return_value=None),
            patch("app.services.attendance._infer_shift_from_checkin_time", return_value=(None, None)),
            patch("app.services.attendance._resolve_fallback_shift", return_value=None),
            patch("app.services.attendance._duplicate_event_id", return_value=None),
        ):
            event = create_checkin_event(
                db,
                device_fingerprint="seq-fp",
                lat=None,
                lon=None,
                accuracy_m=None,
            )

        self.assertEqual(event.type, AttendanceType.IN)
        self.assertEqual(len(db.added), 1)

    def test_checkout_is_allowed_after_midnight_when_open_shift_exists(self) -> None:
        db = _DummyDB()
        device = _build_device()
        open_last_event = SimpleNamespace(type=AttendanceType.IN, flags={})

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_latest_event_for_employee", return_value=open_last_event),
            patch("app.services.attendance.evaluate_location", return_value=(LocationStatus.NO_LOCATION, {})),
            patch("app.services.attendance.resolve_effective_plan_for_employee_day", return_value=None),
            patch("app.services.attendance._resolve_shift_from_last_checkin", return_value=None),
            patch("app.services.attendance._resolve_fallback_shift", return_value=None),
            patch("app.services.attendance._duplicate_event_id", return_value=None),
        ):
            event = create_checkout_event(
                db,
                device_fingerprint="seq-fp",
                lat=None,
                lon=None,
                accuracy_m=None,
                manual=False,
            )

        self.assertEqual(event.type, AttendanceType.OUT)
        self.assertEqual(len(db.added), 1)


if __name__ == "__main__":
    unittest.main()
