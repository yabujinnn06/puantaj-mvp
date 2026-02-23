#!/usr/bin/env python
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.schema_guard import verify_runtime_schema
from app.settings import get_settings

VERSIONS_DIR = ROOT_DIR / "app" / "migrations" / "versions"
ADMIN_INDEX = ROOT_DIR / "app" / "static" / "admin" / "index.html"
EMPLOYEE_INDEX = ROOT_DIR / "app" / "static" / "employee" / "index.html"
ADMIN_STATIC_ROOT = ROOT_DIR / "app" / "static" / "admin"
EMPLOYEE_STATIC_ROOT = ROOT_DIR / "app" / "static" / "employee"


@dataclass(slots=True)
class CheckResult:
    name: str
    status: str
    details: dict[str, Any]

    @property
    def ok(self) -> bool:
        return self.status == "ok"


def _extract_revision_ids() -> list[str]:
    revisions: list[str] = []
    pattern = re.compile(r'^\s*revision\s*:\s*str\s*=\s*"([^"]+)"\s*$', re.MULTILINE)
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue
        content = path.read_text(encoding="utf-8")
        match = pattern.search(content)
        if match:
            revisions.append(match.group(1).strip())
    return revisions


def _asset_paths_from_index(index_path: Path) -> list[str]:
    content = index_path.read_text(encoding="utf-8")
    refs = re.findall(r'(?:src|href)="([^"]+)"', content)
    return [ref.strip() for ref in refs if ref.strip()]


def _resolve_static_reference(ref: str, *, prefix: str, static_root: Path) -> Path | None:
    if not ref.startswith(prefix):
        return None
    relative = ref[len(prefix) :].lstrip("/")
    if not relative:
        return None
    relative = relative.split("?", 1)[0].split("#", 1)[0]
    return static_root / relative


def _check_static_bundle() -> CheckResult:
    missing: list[str] = []
    checks: list[tuple[str, Path | None]] = []
    for ref in _asset_paths_from_index(ADMIN_INDEX):
        checks.append((ref, _resolve_static_reference(ref, prefix="/admin-panel", static_root=ADMIN_STATIC_ROOT)))
    for ref in _asset_paths_from_index(EMPLOYEE_INDEX):
        checks.append((ref, _resolve_static_reference(ref, prefix="/employee", static_root=EMPLOYEE_STATIC_ROOT)))

    for ref, resolved in checks:
        if resolved is None:
            continue
        if not resolved.exists():
            missing.append(ref)

    required_files = [
        ADMIN_STATIC_ROOT / "admin-sw.js",
        EMPLOYEE_STATIC_ROOT / "sw.js",
        EMPLOYEE_STATIC_ROOT / "manifest.webmanifest",
    ]
    for required_file in required_files:
        if not required_file.exists():
            missing.append(str(required_file.relative_to(ROOT_DIR)))

    return CheckResult(
        name="static_bundle_integrity",
        status="ok" if not missing else "fail",
        details={
            "admin_index": str(ADMIN_INDEX.relative_to(ROOT_DIR)),
            "employee_index": str(EMPLOYEE_INDEX.relative_to(ROOT_DIR)),
            "missing": missing,
        },
    )


def _check_push_config() -> CheckResult:
    settings = get_settings()
    public_key_set = bool((settings.push_vapid_public_key or "").strip())
    private_key_set = bool((settings.push_vapid_private_key or "").strip())
    pair_ok = public_key_set == private_key_set
    return CheckResult(
        name="push_config_pair",
        status="ok" if pair_ok else "fail",
        details={
            "push_vapid_public_key_set": public_key_set,
            "push_vapid_private_key_set": private_key_set,
            "pair_ok": pair_ok,
        },
    )


def _check_revision_id_lengths() -> CheckResult:
    revisions = _extract_revision_ids()
    too_long = [revision for revision in revisions if len(revision) > 32]
    return CheckResult(
        name="migration_revision_length",
        status="ok" if not too_long else "fail",
        details={
            "max_len": 32,
            "too_long": too_long,
            "total": len(revisions),
        },
    )


def _expected_alembic_heads() -> list[str]:
    config = Config(str(ROOT_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    return sorted(script.get_heads())


def _check_database_migration_and_schema() -> CheckResult:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        return CheckResult(
            name="database_schema_guard",
            status="warn",
            details={"reason": "DATABASE_URL_NOT_SET"},
        )

    expected_heads = _expected_alembic_heads()
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            current_versions = [
                str(row[0]).strip()
                for row in connection.execute(text("SELECT version_num FROM alembic_version")).fetchall()
                if row and row[0] is not None
            ]
        schema_result = verify_runtime_schema(engine)
    finally:
        engine.dispose()

    missing_heads = [head for head in expected_heads if head not in current_versions]
    status = "ok"
    if missing_heads or (not schema_result.ok):
        status = "fail"

    return CheckResult(
        name="database_schema_guard",
        status=status,
        details={
            "expected_heads": expected_heads,
            "current_versions": current_versions,
            "missing_heads": missing_heads,
            "schema_guard_ok": schema_result.ok,
            "schema_guard_issues": schema_result.issues,
            "schema_guard_warnings": schema_result.warnings,
        },
    )


def main() -> int:
    checks = [
        _check_revision_id_lengths(),
        _check_push_config(),
        _check_static_bundle(),
        _check_database_migration_and_schema(),
    ]
    failed_checks = [check for check in checks if check.status == "fail"]
    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "ok": len(failed_checks) == 0,
        "checks": [
            {
                "name": check.name,
                "status": check.status,
                "details": check.details,
            }
            for check in checks
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if len(failed_checks) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
