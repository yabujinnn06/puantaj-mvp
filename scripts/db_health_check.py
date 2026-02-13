#!/usr/bin/env python
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, text


EXPECTED_HEAD = "0019_admin_push_and_archives"


def load_env_if_exists() -> None:
    env_file = Path(".env")
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def run() -> dict:
    load_env_if_exists()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not found (.env or env vars).")

    engine = create_engine(database_url)
    report: dict = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "database_url": database_url,
        "checks": [],
    }

    def add(name: str, status: str, details: dict) -> None:
        report["checks"].append(
            {
                "name": name,
                "status": status,
                "details": details,
            }
        )

    with engine.connect() as conn:
        tables = set(
            conn.execute(
                text(
                    """
                    select table_name
                    from information_schema.tables
                    where table_schema='public'
                    """
                )
            ).scalars()
        )

        current_versions: list[str] = []
        if "alembic_version" in tables:
            current_versions = [
                row[0]
                for row in conn.execute(text("select version_num from alembic_version")).fetchall()
            ]
        add("alembic_version", "ok" if current_versions else "fail", {"current": current_versions})

        add(
            "migration_up_to_date",
            "ok" if EXPECTED_HEAD in current_versions else "warn",
            {"expected_head": EXPECTED_HEAD, "current": current_versions},
        )

        required_by_revision = {
            "0015+": ["notification_jobs"],
            "0016+": ["device_passkeys", "webauthn_challenges"],
            "0017+": ["qr_codes", "qr_points", "qr_code_points"],
            "0018+": ["device_push_subscriptions"],
            "0019+": ["admin_push_subscriptions", "admin_device_invites", "admin_daily_report_archives"],
        }
        missing = {
            rev: [table for table in required if table not in tables]
            for rev, required in required_by_revision.items()
        }
        missing = {rev: tables_ for rev, tables_ in missing.items() if tables_}
        add("missing_tables_by_revision", "warn" if missing else "ok", missing)

        if "devices" in tables:
            duplicate_active_fingerprints = conn.execute(
                text(
                    """
                    select device_fingerprint, count(*)
                    from devices
                    where is_active = true
                    group by device_fingerprint
                    having count(*) > 1
                    """
                )
            ).fetchall()
            add(
                "duplicate_active_device_fingerprint",
                "fail" if duplicate_active_fingerprints else "ok",
                {"rows": [list(row) for row in duplicate_active_fingerprints]},
            )

        if "attendance_events" in tables:
            orphan_employees = conn.execute(
                text(
                    """
                    select a.id
                    from attendance_events a
                    left join employees e on e.id = a.employee_id
                    where e.id is null
                    limit 20
                    """
                )
            ).fetchall()
            add(
                "attendance_orphan_employee",
                "fail" if orphan_employees else "ok",
                {"sample_ids": [row[0] for row in orphan_employees]},
            )

            orphan_devices = conn.execute(
                text(
                    """
                    select a.id
                    from attendance_events a
                    left join devices d on d.id = a.device_id
                    where d.id is null
                    limit 20
                    """
                )
            ).fetchall()
            add(
                "attendance_orphan_device",
                "fail" if orphan_devices else "ok",
                {"sample_ids": [row[0] for row in orphan_devices]},
            )

    return report


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
