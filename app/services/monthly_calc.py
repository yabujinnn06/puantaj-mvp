from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import ceil
from typing import Literal


@dataclass(frozen=True)
class DayComputation:
    status: str
    gross_minutes: int
    worked_minutes_net: int
    overtime_minutes: int
    effective_break_minutes: int
    legal_min_break_minutes: int
    min_break_not_met: bool
    daily_max_exceeded: bool
    night_work_exceeded: bool


def legal_min_break_minutes(gross_minutes: int) -> int:
    if gross_minutes <= 0:
        return 0
    if gross_minutes <= 240:
        return 15
    if gross_minutes <= 450:
        return 30
    return 60


def _round_overtime(minutes: int, mode: Literal["OFF", "REG_HALF_HOUR"]) -> int:
    if minutes <= 0 or mode == "OFF":
        return max(0, minutes)
    return int(ceil(minutes / 30) * 30)


def calculate_weekly_legal_totals(
    *,
    worked_minutes: int,
    contract_weekly_minutes: int | None,
    weekly_normal_minutes: int,
    overtime_rounding_mode: Literal["OFF", "REG_HALF_HOUR"] = "OFF",
) -> tuple[int, int, int]:
    safe_weekly_normal = max(0, weekly_normal_minutes)
    safe_worked = max(0, worked_minutes)

    if contract_weekly_minutes is None:
        effective_contract = safe_weekly_normal
    else:
        effective_contract = min(max(0, contract_weekly_minutes), safe_weekly_normal)

    normal_minutes = min(safe_worked, effective_contract)
    extra_work_minutes = 0
    if effective_contract < safe_weekly_normal:
        extra_work_minutes = min(
            max(0, safe_worked - effective_contract),
            safe_weekly_normal - effective_contract,
        )

    overtime_minutes = max(0, safe_worked - safe_weekly_normal)
    overtime_minutes = _round_overtime(overtime_minutes, overtime_rounding_mode)
    return normal_minutes, extra_work_minutes, overtime_minutes


def calculate_day_metrics(
    *,
    first_in_ts: datetime | None,
    last_out_ts: datetime | None,
    planned_minutes: int,
    break_minutes: int,
    daily_max_minutes: int,
    night_work_max_minutes: int,
    enforce_min_break: bool,
    is_night_shift: bool = False,
) -> DayComputation:
    if first_in_ts is None or last_out_ts is None:
        return DayComputation(
            status="INCOMPLETE",
            gross_minutes=0,
            worked_minutes_net=0,
            overtime_minutes=0,
            effective_break_minutes=max(0, break_minutes),
            legal_min_break_minutes=0,
            min_break_not_met=False,
            daily_max_exceeded=False,
            night_work_exceeded=False,
        )

    gross_minutes = max(0, int((last_out_ts - first_in_ts).total_seconds() // 60))
    legal_break = legal_min_break_minutes(gross_minutes) if enforce_min_break else 0
    configured_break = max(0, break_minutes)
    effective_break = max(configured_break, legal_break)
    min_break_not_met = enforce_min_break and configured_break < legal_break and gross_minutes > 0

    worked_minutes_net = max(0, gross_minutes - effective_break)
    overtime_minutes = max(0, worked_minutes_net - max(0, planned_minutes))
    daily_max_exceeded = gross_minutes > max(0, daily_max_minutes)
    night_work_exceeded = is_night_shift and gross_minutes > max(0, night_work_max_minutes)

    return DayComputation(
        status="OK",
        gross_minutes=gross_minutes,
        worked_minutes_net=worked_minutes_net,
        overtime_minutes=overtime_minutes,
        effective_break_minutes=effective_break,
        legal_min_break_minutes=legal_break,
        min_break_not_met=min_break_not_met,
        daily_max_exceeded=daily_max_exceeded,
        night_work_exceeded=night_work_exceeded,
    )


def calculate_work_and_overtime(
    *,
    first_in_ts: datetime | None,
    last_out_ts: datetime | None,
    planned_minutes: int,
    break_minutes: int,
) -> tuple[str, int, int]:
    metrics = calculate_day_metrics(
        first_in_ts=first_in_ts,
        last_out_ts=last_out_ts,
        planned_minutes=planned_minutes,
        break_minutes=break_minutes,
        daily_max_minutes=24 * 60,
        night_work_max_minutes=24 * 60,
        enforce_min_break=False,
        is_night_shift=False,
    )
    return metrics.status, metrics.worked_minutes_net, metrics.overtime_minutes
