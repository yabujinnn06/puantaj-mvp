from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


@dataclass(frozen=True, slots=True)
class SchemaGuardResult:
    ok: bool
    checked_at_utc: datetime
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "checked_at_utc": self.checked_at_utc.isoformat(),
            "issues": list(self.issues),
            "warnings": list(self.warnings),
            "issue_count": len(self.issues),
            "warning_count": len(self.warnings),
        }


REQUIRED_TABLE_COLUMNS: dict[str, set[str]] = {
    "employees": {"id", "shift_id"},
    "attendance_events": {"id", "source"},
    "alembic_version": {"version_num"},
}

REQUIRED_ENUM_VALUES: dict[str, set[str]] = {
    "attendance_event_source": {"DEVICE", "MANUAL"},
}


def verify_runtime_schema(engine: Engine) -> SchemaGuardResult:
    issues: list[str] = []
    warnings: list[str] = []
    checked_at_utc = datetime.now(timezone.utc)
    inspector = inspect(engine)

    for table_name, required_columns in REQUIRED_TABLE_COLUMNS.items():
        try:
            column_names = {str(item.get("name")) for item in inspector.get_columns(table_name)}
        except Exception as exc:  # pragma: no cover - defensive
            issues.append(f"TABLE_UNREADABLE:{table_name}:{exc.__class__.__name__}")
            continue

        missing_columns = sorted(item for item in required_columns if item not in column_names)
        if missing_columns:
            issues.append(f"MISSING_COLUMNS:{table_name}:{','.join(missing_columns)}")

    try:
        enums = inspector.get_enums() or []
    except Exception as exc:  # pragma: no cover - defensive
        warnings.append(f"ENUM_INSPECTION_FAILED:{exc.__class__.__name__}")
        enums = []

    enum_values_by_name: dict[str, set[str]] = {}
    for enum_item in enums:
        name = str(enum_item.get("name") or "").strip()
        if not name:
            continue
        labels = enum_item.get("labels")
        if isinstance(labels, list):
            enum_values_by_name[name] = {str(label) for label in labels}

    for enum_name, required_values in REQUIRED_ENUM_VALUES.items():
        if enum_name not in enum_values_by_name:
            warnings.append(f"ENUM_NOT_FOUND:{enum_name}")
            continue
        missing_values = sorted(item for item in required_values if item not in enum_values_by_name[enum_name])
        if missing_values:
            issues.append(f"MISSING_ENUM_VALUES:{enum_name}:{','.join(missing_values)}")

    try:
        with engine.connect() as connection:
            row = connection.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
            version = str(row).strip() if row is not None else ""
            if not version:
                issues.append("ALEMBIC_VERSION_EMPTY")
    except Exception as exc:  # pragma: no cover - defensive
        issues.append(f"ALEMBIC_VERSION_CHECK_FAILED:{exc.__class__.__name__}")

    return SchemaGuardResult(
        ok=len(issues) == 0,
        checked_at_utc=checked_at_utc,
        issues=issues,
        warnings=warnings,
    )
