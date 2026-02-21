from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.schema_guard import verify_runtime_schema


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):  # type: ignore[no-untyped-def]
        return self._value


class _FakeConnection:
    def __init__(self, version_value):
        self._version_value = version_value

    def __enter__(self):  # type: ignore[no-untyped-def]
        return self

    def __exit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
        return False

    def execute(self, _statement):  # type: ignore[no-untyped-def]
        return _FakeResult(self._version_value)


class _FakeEngine:
    def __init__(self, version_value):
        self._version_value = version_value

    def connect(self):  # type: ignore[no-untyped-def]
        return _FakeConnection(self._version_value)


class _FakeInspector:
    def __init__(self, *, columns_by_table: dict[str, set[str]], enums: list[dict[str, object]]):
        self._columns_by_table = columns_by_table
        self._enums = enums

    def get_columns(self, table_name: str):  # type: ignore[no-untyped-def]
        columns = self._columns_by_table[table_name]
        return [{"name": item} for item in columns]

    def get_enums(self):  # type: ignore[no-untyped-def]
        return self._enums


class SchemaGuardTests(unittest.TestCase):
    def test_verify_runtime_schema_ok_when_required_columns_exist(self) -> None:
        fake_inspector = _FakeInspector(
            columns_by_table={
                "employees": {"id", "full_name", "shift_id"},
                "attendance_events": {"id", "source", "employee_id"},
                "devices": {"id", "recovery_pin_hash", "recovery_admin_vault"},
                "device_recovery_codes": {"id", "device_id", "code_hash", "expires_at"},
                "alembic_version": {"version_num"},
            },
            enums=[{"name": "attendance_event_source", "labels": ["DEVICE", "MANUAL"]}],
        )
        fake_engine = _FakeEngine("0012_plan_emp_scope")

        with patch("app.services.schema_guard.inspect", return_value=fake_inspector):
            result = verify_runtime_schema(fake_engine)  # type: ignore[arg-type]

        self.assertTrue(result.ok)
        self.assertEqual(result.issues, [])
        self.assertEqual(result.warnings, [])

    def test_verify_runtime_schema_reports_missing_columns(self) -> None:
        fake_inspector = _FakeInspector(
            columns_by_table={
                "employees": {"id", "full_name"},
                "attendance_events": {"id", "employee_id"},
                "devices": {"id"},
                "device_recovery_codes": {"id", "device_id"},
                "alembic_version": {"version_num"},
            },
            enums=[{"name": "attendance_event_source", "labels": ["DEVICE"]}],
        )
        fake_engine = _FakeEngine("")

        with patch("app.services.schema_guard.inspect", return_value=fake_inspector):
            result = verify_runtime_schema(fake_engine)  # type: ignore[arg-type]

        self.assertFalse(result.ok)
        self.assertTrue(any(item.startswith("MISSING_COLUMNS:employees:shift_id") for item in result.issues))
        self.assertTrue(any(item.startswith("MISSING_COLUMNS:attendance_events:source") for item in result.issues))
        self.assertTrue(any(item.startswith("MISSING_COLUMNS:devices:") for item in result.issues))
        self.assertTrue(any(item.startswith("MISSING_ENUM_VALUES:attendance_event_source:MANUAL") for item in result.issues))
        self.assertIn("ALEMBIC_VERSION_EMPTY", result.issues)


if __name__ == "__main__":
    unittest.main()
