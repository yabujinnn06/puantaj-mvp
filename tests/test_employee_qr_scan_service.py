from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.errors import ApiError
from app.models import (
    AttendanceType,
    Device,
    Employee,
    QRCode,
    QRCodeType,
    QRPoint,
)
from app.services.attendance import QRScanDeniedError, create_employee_qr_scan_event


class _DummyDB:
    def scalars(self, _statement):  # type: ignore[no-untyped-def]
        class _Rows:
            @staticmethod
            def all():
                return []

        return _Rows()


def _build_device(employee_id: int = 1) -> Device:
    employee = Employee(id=employee_id, full_name="Test Employee", department_id=None, is_active=True)
    device = Device(id=11, employee_id=employee_id, device_fingerprint="fp-1", is_active=True)
    device.employee = employee
    return device


def _build_qr_code(code_type: QRCodeType) -> QRCode:
    return QRCode(
        id=7,
        name="HQ",
        code_value="IN|HQ",
        code_type=code_type,
        is_active=True,
    )


def _build_point(point_id: int, lat: float, lon: float, radius_m: int) -> QRPoint:
    return QRPoint(
        id=point_id,
        name=f"P{point_id}",
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        is_active=True,
    )


class EmployeeQrScanServiceTests(unittest.TestCase):
    def test_multiple_points_only_one_matches(self) -> None:
        db = _DummyDB()
        device = _build_device()
        code = _build_qr_code(QRCodeType.CHECKIN)
        far_point = _build_point(101, 41.0200, 29.0000, 75)
        near_point = _build_point(102, 41.0002, 29.0000, 75)
        fake_event = object()

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_qr_code_by_value", return_value=code),
            patch("app.services.attendance._load_active_qr_points_for_code", return_value=[far_point, near_point]),
            patch("app.services.attendance._build_attendance_event", return_value=fake_event) as build_event_mock,
        ):
            result = create_employee_qr_scan_event(
                db,
                device_fingerprint="fp-1",
                code_value="IN|HQ",
                lat=41.0,
                lon=29.0,
                accuracy_m=12.0,
            )

        self.assertIs(result, fake_event)
        kwargs = build_event_mock.call_args.kwargs
        self.assertEqual(kwargs["event_type"], AttendanceType.IN)
        self.assertEqual(kwargs["extra_flags"]["qr"]["matched_point_id"], 102)

    def test_multiple_matches_choose_closest(self) -> None:
        db = _DummyDB()
        device = _build_device()
        code = _build_qr_code(QRCodeType.CHECKIN)
        medium_point = _build_point(201, 41.0007, 29.0000, 120)
        closest_point = _build_point(202, 41.0002, 29.0000, 120)
        fake_event = object()

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_qr_code_by_value", return_value=code),
            patch(
                "app.services.attendance._load_active_qr_points_for_code",
                return_value=[medium_point, closest_point],
            ),
            patch("app.services.attendance._build_attendance_event", return_value=fake_event) as build_event_mock,
        ):
            create_employee_qr_scan_event(
                db,
                device_fingerprint="fp-1",
                code_value="IN|HQ",
                lat=41.0,
                lon=29.0,
                accuracy_m=10.0,
            )

        kwargs = build_event_mock.call_args.kwargs
        qr_flags = kwargs["extra_flags"]["qr"]
        self.assertEqual(qr_flags["matched_point_id"], 202)
        self.assertLessEqual(qr_flags["distance_m"], qr_flags["radius_m"])

    def test_denied_scan_returns_closest_distance(self) -> None:
        db = _DummyDB()
        device = _build_device()
        code = _build_qr_code(QRCodeType.CHECKIN)
        very_far = _build_point(301, 41.0300, 29.0300, 60)

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_qr_code_by_value", return_value=code),
            patch("app.services.attendance._load_active_qr_points_for_code", return_value=[very_far]),
        ):
            with self.assertRaises(QRScanDeniedError) as ctx:
                create_employee_qr_scan_event(
                    db,
                    device_fingerprint="fp-1",
                    code_value="IN|HQ",
                    lat=41.0,
                    lon=29.0,
                    accuracy_m=30.0,
                )

        self.assertEqual(ctx.exception.reason, "QR_POINT_OUT_OF_RANGE")
        self.assertIsNotNone(ctx.exception.closest_distance_m)
        self.assertGreater(ctx.exception.closest_distance_m or 0, 60)

    def test_both_toggle_behavior(self) -> None:
        db = _DummyDB()
        device = _build_device()
        code = _build_qr_code(QRCodeType.BOTH)
        point = _build_point(401, 41.0002, 29.0000, 90)

        for open_shift_event, expected_type in (
            (SimpleNamespace(type=AttendanceType.IN), AttendanceType.OUT),
            (None, AttendanceType.IN),
        ):
            fake_event = object()
            with self.subTest(open_shift_event_type=getattr(open_shift_event, "type", None)):
                with (
                    patch("app.services.attendance._resolve_active_device", return_value=device),
                    patch("app.services.attendance._resolve_qr_code_by_value", return_value=code),
                    patch("app.services.attendance._load_active_qr_points_for_code", return_value=[point]),
                    patch(
                        "app.services.attendance._resolve_active_open_shift_event",
                        return_value=open_shift_event,
                    ),
                    patch("app.services.attendance._build_attendance_event", return_value=fake_event) as build_event_mock,
                ):
                    result = create_employee_qr_scan_event(
                        db,
                        device_fingerprint="fp-1",
                        code_value="BOTH-HQ",
                        lat=41.0,
                        lon=29.0,
                        accuracy_m=8.0,
                    )

                self.assertIs(result, fake_event)
                kwargs = build_event_mock.call_args.kwargs
                self.assertEqual(kwargs["event_type"], expected_type)

    def test_double_scan_within_five_minutes_is_blocked(self) -> None:
        db = _DummyDB()
        device = _build_device()
        code = _build_qr_code(QRCodeType.CHECKIN)
        point = _build_point(501, 41.0002, 29.0000, 90)
        recent_event = SimpleNamespace(
            id=999,
            ts_utc=datetime.now(timezone.utc) - timedelta(minutes=1),
            flags={"qr": {"code_id": 7}},
        )

        with (
            patch("app.services.attendance._resolve_active_device", return_value=device),
            patch("app.services.attendance._resolve_recent_qr_scan_event", return_value=recent_event),
            patch("app.services.attendance._resolve_qr_code_by_value", return_value=code),
            patch("app.services.attendance._load_active_qr_points_for_code", return_value=[point]),
        ):
            with self.assertRaises(ApiError) as ctx:
                create_employee_qr_scan_event(
                    db,
                    device_fingerprint="fp-1",
                    code_value="IN|HQ",
                    lat=41.0,
                    lon=29.0,
                    accuracy_m=12.0,
                )

        self.assertEqual(ctx.exception.code, "QR_DOUBLE_SCAN_BLOCKED")


if __name__ == "__main__":
    unittest.main()
