from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Literal

from fastapi import HTTPException, status
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AttendanceEvent, AttendanceType, Department, Employee, WorkRule
from app.schemas import MonthlyEmployeeResponse
from app.services.monthly import calculate_employee_monthly
from app.services.monthly_calc import calculate_work_and_overtime

ExportMode = Literal["employee", "department", "all", "date_range"]
RangeSheetMode = Literal["consolidated", "employee_sheets", "department_sheets"]

DEFAULT_DAILY_MINUTES_PLANNED = 540
DEFAULT_BREAK_MINUTES = 60
DEFAULT_WEEKLY_NORMAL_MINUTES = 45 * 60

DAILY_HEADERS = [
    "Tarih",
    "Giri\u015f",
    "\u00c7\u0131k\u0131\u015f",
    "\u00c7al\u0131\u015fma S\u00fcresi (saat:dakika)",
    "Mola",
    "Net S\u00fcre",
    "Fazla S\u00fcrelerle \u00c7al\u0131\u015fma",
    "Fazla Mesai",
    "Durum",
    "Bayraklar",
]

HEADER_FILL = PatternFill(fill_type="solid", fgColor="0B4F73")
SUBHEADER_FILL = PatternFill(fill_type="solid", fgColor="DCEBF3")
META_LABEL_FILL = PatternFill(fill_type="solid", fgColor="EAF4F9")
META_VALUE_FILL = PatternFill(fill_type="solid", fgColor="F8FCFF")
ZEBRA_FILL = PatternFill(fill_type="solid", fgColor="F7FBFE")
WARNING_FILL = PatternFill(fill_type="solid", fgColor="FFF3CD")
ALERT_FILL = PatternFill(fill_type="solid", fgColor="FDE2E4")
SUCCESS_FILL = PatternFill(fill_type="solid", fgColor="E6F4EA")
SUMMARY_FILL = PatternFill(fill_type="solid", fgColor="E9F1F7")

HEADER_FONT = Font(bold=True, color="FFFFFF")
BOLD_FONT = Font(bold=True, color="0F172A")
TITLE_FONT = Font(bold=True, color="0B4F73", size=14)
MUTED_FONT = Font(color="334155")

THIN_SIDE = Side(style="thin", color="D5E2EC")
THIN_BORDER = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=THIN_SIDE)


def _to_excel_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _minutes_to_hhmm(minutes: int) -> str:
    value = max(0, int(minutes))
    hours = value // 60
    mins = value % 60
    return f"{hours:02d}:{mins:02d}"


def _week_start(day_value: date) -> date:
    return day_value - timedelta(days=day_value.weekday())


def _effective_contract_weekly_minutes(
    contract_weekly_minutes: int | None,
    weekly_normal_minutes: int,
) -> int:
    if contract_weekly_minutes is None:
        return weekly_normal_minutes
    return min(max(0, int(contract_weekly_minutes)), weekly_normal_minutes)


def _rebalance_allocations(
    entries: list[dict[str, int | date]],
    *,
    field_name: str,
    target_total: int,
) -> None:
    target_value = max(0, int(target_total))
    current_value = sum(int(entry[field_name]) for entry in entries)
    delta = target_value - current_value
    if delta == 0:
        return

    if delta > 0:
        for entry in reversed(entries):
            if int(entry["worked_minutes"]) > 0:
                entry[field_name] = int(entry[field_name]) + delta
                return
        if entries:
            entries[-1][field_name] = int(entries[-1][field_name]) + delta
        return

    remaining = abs(delta)
    for entry in reversed(entries):
        current = int(entry[field_name])
        take = min(current, remaining)
        if take > 0:
            entry[field_name] = current - take
            remaining -= take
        if remaining <= 0:
            break


def _build_daily_legal_breakdown(
    report: MonthlyEmployeeResponse,
    *,
    contract_weekly_minutes: int | None,
) -> dict[date, tuple[int, int]]:
    weekly_normal_minutes = (
        max(0, int(report.labor_profile.weekly_normal_minutes_default))
        if report.labor_profile is not None
        else DEFAULT_WEEKLY_NORMAL_MINUTES
    )
    effective_contract = _effective_contract_weekly_minutes(
        contract_weekly_minutes,
        weekly_normal_minutes,
    )

    weekly_targets = {
        item.week_start: (
            max(0, int(item.extra_work_minutes)),
            max(0, int(item.overtime_minutes)),
        )
        for item in report.weekly_totals
    }

    week_entries: dict[date, list[dict[str, int | date]]] = defaultdict(list)
    for day in sorted(report.days, key=lambda item: item.date):
        week_entries[_week_start(day.date)].append(
            {
                "date": day.date,
                "worked_minutes": max(0, int(day.worked_minutes)),
                "extra_work_minutes": 0,
                "overtime_minutes": 0,
            }
        )

    result: dict[date, tuple[int, int]] = {}
    for week_start, entries in week_entries.items():
        cumulative_minutes = 0
        for entry in entries:
            worked_minutes = max(0, int(entry["worked_minutes"]))
            before = cumulative_minutes
            after = before + worked_minutes

            extra_work = max(0, min(after, weekly_normal_minutes) - max(before, effective_contract))
            overtime = max(0, after - max(before, weekly_normal_minutes))
            entry["extra_work_minutes"] = extra_work
            entry["overtime_minutes"] = overtime
            cumulative_minutes = after

        target_extra, target_overtime = weekly_targets.get(
            week_start,
            (
                sum(int(item["extra_work_minutes"]) for item in entries),
                sum(int(item["overtime_minutes"]) for item in entries),
            ),
        )
        _rebalance_allocations(entries, field_name="extra_work_minutes", target_total=target_extra)
        _rebalance_allocations(entries, field_name="overtime_minutes", target_total=target_overtime)

        for entry in entries:
            result[entry["date"]] = (int(entry["extra_work_minutes"]), int(entry["overtime_minutes"]))

    return result


def _style_header(ws: Worksheet, row: int = 1) -> None:
    for cell in ws[row]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = THIN_BORDER


def _auto_width(ws: Worksheet) -> None:
    for column_cells in ws.iter_cols(min_row=1, max_row=ws.max_row, min_col=1, max_col=ws.max_column):
        max_len = 0
        col_letter = get_column_letter(column_cells[0].column)
        for cell in column_cells:
            if cell.coordinate in ws.merged_cells:
                continue
            value = "" if cell.value is None else str(cell.value)
            max_len = max(max_len, len(value))
        ws.column_dimensions[col_letter].width = min(max_len + 2, 45)


def _merge_title(ws: Worksheet, row: int, text: str) -> None:
    max_col = max(ws.max_column, 10)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=max_col)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = TITLE_FONT
    cell.alignment = Alignment(horizontal="left", vertical="center")


def _style_metadata_rows(ws: Worksheet, *, start_row: int, end_row: int) -> None:
    for row_idx in range(start_row, end_row + 1):
        label_cell = ws.cell(row=row_idx, column=1)
        value_cell = ws.cell(row=row_idx, column=2)
        label_cell.font = BOLD_FONT
        label_cell.fill = META_LABEL_FILL
        label_cell.alignment = Alignment(horizontal="left", vertical="center")
        label_cell.border = THIN_BORDER

        value_cell.font = MUTED_FONT
        value_cell.fill = META_VALUE_FILL
        value_cell.alignment = Alignment(horizontal="left", vertical="center")
        value_cell.border = THIN_BORDER


def _is_hhmm_value(value: object) -> bool:
    if not isinstance(value, str):
        return False
    if len(value) != 5 or value[2] != ":":
        return False
    hh, mm = value.split(":")
    return hh.isdigit() and mm.isdigit()


def _style_table_region(
    ws: Worksheet,
    *,
    header_row: int,
    data_start_row: int,
    data_end_row: int,
    status_col_name: str = "Durum",
    flags_col_name: str = "Bayraklar",
) -> None:
    if data_end_row < data_start_row:
        ws.freeze_panes = f"A{header_row + 1}"
        return

    header_map: dict[str, int] = {}
    for col_idx in range(1, ws.max_column + 1):
        header_value = ws.cell(row=header_row, column=col_idx).value
        if isinstance(header_value, str):
            header_map[header_value] = col_idx

    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(ws.max_column)}{data_end_row}"
    ws.freeze_panes = f"A{header_row + 1}"

    status_col = header_map.get(status_col_name)
    flags_col = header_map.get(flags_col_name)
    overtime_cols = [
        idx
        for name, idx in header_map.items()
        if "Fazla Mesai" in name or "Fazla Surelerle" in name or "Fazla S\u00fcrelerle" in name
    ]

    for row_idx in range(data_start_row, data_end_row + 1):
        status_value = ws.cell(row=row_idx, column=status_col).value if status_col else None
        flags_value = ws.cell(row=row_idx, column=flags_col).value if flags_col else None

        if isinstance(status_value, str) and status_value.upper() in {"INCOMPLETE", "LEAVE", "OFF"}:
            row_fill = WARNING_FILL
        elif isinstance(status_value, str) and status_value.upper() in {"OK", "FINISHED"}:
            row_fill = PatternFill(fill_type=None)
        else:
            row_fill = PatternFill(fill_type=None)

        if row_fill.fill_type is None and row_idx % 2 == 0:
            row_fill = ZEBRA_FILL

        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.border = THIN_BORDER
            if row_fill.fill_type:
                cell.fill = row_fill
            if isinstance(cell.value, (int, float)):
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif _is_hhmm_value(cell.value):
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

        if flags_col and flags_value not in {None, "", "-"}:
            flag_cell = ws.cell(row=row_idx, column=flags_col)
            flag_cell.fill = ALERT_FILL
            flag_cell.font = Font(bold=True, color="9F1239")

        for overtime_col in overtime_cols:
            overtime_cell = ws.cell(row=row_idx, column=overtime_col)
            if overtime_cell.value not in {None, "", "00:00", 0}:
                overtime_cell.fill = SUCCESS_FILL
                overtime_cell.font = Font(bold=True, color="166534")


def _safe_sheet_title(title: str, fallback: str) -> str:
    cleaned = "".join(ch for ch in title if ch not in ['\\', '/', '*', '?', ':', '[', ']']).strip()
    if not cleaned:
        cleaned = fallback
    return cleaned[:31]


def _work_rule_minutes(db: Session, department_id: int | None, cache: dict[int | None, tuple[int, int]]) -> tuple[int, int]:
    if department_id in cache:
        return cache[department_id]

    if department_id is None:
        cache[department_id] = (DEFAULT_DAILY_MINUTES_PLANNED, DEFAULT_BREAK_MINUTES)
        return cache[department_id]

    rule = db.scalar(select(WorkRule).where(WorkRule.department_id == department_id))
    if rule is None:
        cache[department_id] = (DEFAULT_DAILY_MINUTES_PLANNED, DEFAULT_BREAK_MINUTES)
        return cache[department_id]

    cache[department_id] = (rule.daily_minutes_planned, rule.break_minutes)
    return cache[department_id]


def _gross_minutes(check_in: datetime | None, check_out: datetime | None) -> int:
    if check_in is None or check_out is None:
        return 0
    return max(0, int((check_out - check_in).total_seconds() // 60))


def _time_range_label(check_in: datetime | None, check_out: datetime | None) -> str:
    if check_in is None or check_out is None:
        return "-"
    in_ts = _to_excel_datetime(check_in)
    out_ts = _to_excel_datetime(check_out)
    if in_ts is None or out_ts is None:
        return "-"
    return f"{in_ts:%H:%M} - {out_ts:%H:%M}"


def _append_summary_area(
    ws: Worksheet,
    *,
    report: MonthlyEmployeeResponse,
    total_extra_work_minutes: int = 0,
    total_legal_overtime_minutes: int | None = None,
) -> tuple[int, int]:
    if total_legal_overtime_minutes is None:
        total_legal_overtime_minutes = sum(item.overtime_minutes for item in report.weekly_totals)

    ws.append([])
    summary_start = ws.max_row + 1
    ws.append(["\u00d6zet", "De\u011fer"])
    ws.append(["Toplam Net S\u00fcre", _minutes_to_hhmm(report.totals.worked_minutes)])
    ws.append(["Toplam Fazla S\u00fcrelerle \u00c7al\u0131\u015fma", _minutes_to_hhmm(total_extra_work_minutes)])
    ws.append(["Toplam Fazla Mesai", _minutes_to_hhmm(total_legal_overtime_minutes)])
    ws.append(["Eksik G\u00fcn", report.totals.incomplete_days])
    ws.append(["Y\u0131ll\u0131k Fazla Mesai Kullan\u0131m\u0131", _minutes_to_hhmm(report.annual_overtime_used_minutes)])
    _style_header(ws, summary_start)

    summary_end = ws.max_row
    for row_idx in range(summary_start + 1, summary_end + 1):
        label_cell = ws.cell(row=row_idx, column=1)
        value_cell = ws.cell(row=row_idx, column=2)
        label_cell.fill = SUMMARY_FILL
        label_cell.border = THIN_BORDER
        label_cell.font = BOLD_FONT
        value_cell.fill = PatternFill(fill_type="solid", fgColor="F8FBFF")
        value_cell.border = THIN_BORDER
        value_cell.alignment = Alignment(horizontal="center", vertical="center")
        if _is_hhmm_value(value_cell.value):
            value_cell.font = Font(bold=True, color="0B4F73")
    return summary_start, summary_end


def _append_employee_daily_sheet(
    ws: Worksheet,
    *,
    employee_name: str,
    department_name: str | None,
    report: MonthlyEmployeeResponse,
    contract_weekly_minutes: int | None = None,
) -> None:
    _merge_title(ws, 1, "PUANTAJ AYLIK RAPORU")
    ws.append(["\u00c7al\u0131\u015fan", employee_name])
    ws.append(["Departman", department_name or "-"])
    ws.append(["D\u00f6nem", f"{report.year}-{report.month:02d}"])
    ws.append(["Rapor \u00dcretim (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")])
    ws.append([])
    _style_metadata_rows(ws, start_row=2, end_row=5)

    header_row = ws.max_row + 1
    ws.append(DAILY_HEADERS)
    _style_header(ws, header_row)

    total_extra_work_minutes = sum(week.extra_work_minutes for week in report.weekly_totals)
    total_legal_overtime_minutes = sum(week.overtime_minutes for week in report.weekly_totals)
    daily_legal_breakdown = _build_daily_legal_breakdown(
        report,
        contract_weekly_minutes=contract_weekly_minutes,
    )
    data_start_row = header_row + 1

    for day in report.days:
        check_in = _to_excel_datetime(day.check_in)
        check_out = _to_excel_datetime(day.check_out)
        gross_minutes = _gross_minutes(day.check_in, day.check_out)
        break_minutes = max(0, gross_minutes - day.worked_minutes)
        extra_work_minutes, legal_overtime_minutes = daily_legal_breakdown.get(
            day.date,
            (0, max(0, int(day.overtime_minutes))),
        )
        ws.append(
            [
                day.date,
                check_in,
                check_out,
                _minutes_to_hhmm(gross_minutes),
                _minutes_to_hhmm(break_minutes),
                _minutes_to_hhmm(day.worked_minutes),
                _minutes_to_hhmm(extra_work_minutes),
                _minutes_to_hhmm(legal_overtime_minutes),
                day.status,
                ", ".join(day.flags) if day.flags else "-",
            ]
        )

    data_end_row = ws.max_row
    _style_table_region(
        ws,
        header_row=header_row,
        data_start_row=data_start_row,
        data_end_row=data_end_row,
    )

    _append_summary_area(
        ws,
        report=report,
        total_extra_work_minutes=total_extra_work_minutes,
        total_legal_overtime_minutes=total_legal_overtime_minutes,
    )

    for row in ws.iter_rows(min_row=data_start_row, max_row=data_end_row):
        if isinstance(row[0].value, datetime) or isinstance(row[0].value, date):
            row[0].number_format = "yyyy-mm-dd"
        if row[1].value is not None:
            row[1].number_format = "hh:mm"
        if row[2].value is not None:
            row[2].number_format = "hh:mm"

    _auto_width(ws)


def _build_employee_export(
    db: Session,
    wb: Workbook,
    *,
    employee_id: int,
    year: int,
    month: int,
) -> None:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    department_name = employee.department.name if employee.department is not None else None
    report = calculate_employee_monthly(db, employee_id=employee_id, year=year, month=month)
    ws = wb.active
    ws.title = _safe_sheet_title(f"Calisan {employee.id}", "Calisan")
    _append_employee_daily_sheet(
        ws,
        employee_name=employee.full_name,
        department_name=department_name,
        report=report,
        contract_weekly_minutes=employee.contract_weekly_minutes,
    )


def _build_summary_sheet(
    ws: Worksheet,
    *,
    title: str,
    rows: list[dict[str, object]],
) -> None:
    ws.title = _safe_sheet_title(title, "Ozet")
    _merge_title(ws, 1, f"{title} - PUANTAJ OZET")
    ws.append(["Rapor \u00dcretim (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")])
    ws.append(["Kay\u0131t Say\u0131s\u0131", len(rows)])
    ws.append([])
    _style_metadata_rows(ws, start_row=2, end_row=3)

    header_row = ws.max_row + 1
    ws.append(
        [
            "\u00c7al\u0131\u015fan ID",
            "\u00c7al\u0131\u015fan Ad\u0131",
            "Departman",
            "Toplam Net S\u00fcre",
            "Toplam Fazla S\u00fcrelerle \u00c7al\u0131\u015fma",
            "Toplam Fazla Mesai",
            "Eksik G\u00fcn",
            "Y\u0131ll\u0131k Fazla Mesai Kullan\u0131m\u0131",
        ]
    )
    _style_header(ws, header_row)

    total_worked = 0
    total_extra = 0
    total_overtime = 0
    total_incomplete = 0
    total_annual = 0
    data_start_row = header_row + 1
    for row in rows:
        worked = int(row["worked_minutes"])
        extra = int(row["extra_work_minutes"])
        overtime = int(row["overtime_minutes"])
        incomplete = int(row["incomplete_days"])
        annual = int(row["annual_overtime_minutes"])

        total_worked += worked
        total_extra += extra
        total_overtime += overtime
        total_incomplete += incomplete
        total_annual += annual

        ws.append(
            [
                row["employee_id"],
                row["employee_name"],
                row["department_name"],
                _minutes_to_hhmm(worked),
                _minutes_to_hhmm(extra),
                _minutes_to_hhmm(overtime),
                incomplete,
                _minutes_to_hhmm(annual),
            ]
        )

    data_end_row = ws.max_row
    _style_table_region(
        ws,
        header_row=header_row,
        data_start_row=data_start_row,
        data_end_row=data_end_row,
        status_col_name="",
        flags_col_name="",
    )

    total_row = ws.max_row + 1
    ws.append(
        [
            "Toplam",
            "",
            "",
            _minutes_to_hhmm(total_worked),
            _minutes_to_hhmm(total_extra),
            _minutes_to_hhmm(total_overtime),
            total_incomplete,
            _minutes_to_hhmm(total_annual),
        ]
    )
    for cell in ws[total_row]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
    _auto_width(ws)


def _build_department_or_all_export(
    db: Session,
    wb: Workbook,
    *,
    year: int,
    month: int,
    department_id: int | None,
    include_daily_sheet: bool,
    include_inactive: bool,
) -> None:
    employee_stmt = select(Employee).order_by(Employee.id.asc())
    if not include_inactive:
        employee_stmt = employee_stmt.where(Employee.is_active.is_(True))
    if department_id is not None:
        employee_stmt = employee_stmt.where(Employee.department_id == department_id)
    employees = list(db.scalars(employee_stmt).all())

    ws_summary = wb.active
    summary_rows: list[dict[str, object]] = []
    for employee in employees:
        report = calculate_employee_monthly(db, employee_id=employee.id, year=year, month=month)
        department_name = employee.department.name if employee.department is not None else "-"
        summary_rows.append(
            {
                "employee_id": employee.id,
                "employee_name": employee.full_name,
                "department_name": department_name,
                "worked_minutes": report.totals.worked_minutes,
                "extra_work_minutes": sum(week.extra_work_minutes for week in report.weekly_totals),
                "overtime_minutes": sum(week.overtime_minutes for week in report.weekly_totals),
                "incomplete_days": report.totals.incomplete_days,
                "annual_overtime_minutes": report.annual_overtime_used_minutes,
            }
        )
        if include_daily_sheet:
            ws_daily = wb.create_sheet(
                _safe_sheet_title(f"{employee.full_name} ({employee.id})", f"Emp{employee.id}")
            )
            _append_employee_daily_sheet(
                ws_daily,
                employee_name=employee.full_name,
                department_name=department_name,
                report=report,
                contract_weekly_minutes=employee.contract_weekly_minutes,
            )

    summary_title = "Departman Ozeti" if department_id is not None else "Tum Calisanlar Ozeti"
    _build_summary_sheet(ws_summary, title=summary_title, rows=summary_rows)


def _build_date_range_export(
    db: Session,
    wb: Workbook,
    *,
    start_date: date,
    end_date: date,
    employee_id: int | None,
    department_id: int | None,
) -> None:
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be >= start_date",
        )

    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    stmt = (
        select(AttendanceEvent, Employee, Department)
        .join(Employee, AttendanceEvent.employee_id == Employee.id)
        .outerjoin(Department, Employee.department_id == Department.id)
        .where(
            AttendanceEvent.ts_utc >= start_dt,
            AttendanceEvent.ts_utc < end_dt,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )
    if employee_id is not None:
        stmt = stmt.where(AttendanceEvent.employee_id == employee_id)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)

    rows = list(db.execute(stmt).all())

    ws_events = wb.active
    ws_events.title = "Ham Eventler"
    _merge_title(ws_events, 1, "PUANTAJ HAM EVENT RAPORU")
    ws_events.append(["Tarih Aral\u0131\u011f\u0131", f"{start_date.isoformat()} - {end_date.isoformat()}"])
    ws_events.append(["Filtre - \u00c7al\u0131\u015fan ID", employee_id if employee_id is not None else "T\u00fcm\u00fc"])
    ws_events.append(["Filtre - Departman ID", department_id if department_id is not None else "T\u00fcm\u00fc"])
    ws_events.append(["Kay\u0131t Say\u0131s\u0131", len(rows)])
    ws_events.append([])
    _style_metadata_rows(ws_events, start_row=2, end_row=5)

    events_header_row = ws_events.max_row + 1
    ws_events.append(
        [
            "Event ID",
            "\u00c7al\u0131\u015fan ID",
            "\u00c7al\u0131\u015fan Ad\u0131",
            "Departman",
            "Tip",
            "Zaman (UTC)",
            "Konum Durumu",
            "Enlem",
            "Boylam",
            "Dogruluk (m)",
            "Bayraklar",
        ]
    )
    _style_header(ws_events, events_header_row)

    grouped: dict[tuple[int, date], dict[str, object]] = defaultdict(
        lambda: {
            "employee_name": "",
            "department_name": "-",
            "department_id": None,
            "employee_ref": None,
            "shift_name": "-",
            "ins": [],
            "outs": [],
            "flags": set(),
        }
    )
    for event, employee, department in rows:
        flags = ", ".join([k for k, v in (event.flags or {}).items() if v is True]) or "-"
        ws_events.append(
            [
                event.id,
                event.employee_id,
                employee.full_name,
                department.name if department is not None else "-",
                event.type.value,
                _to_excel_datetime(event.ts_utc),
                event.location_status.value,
                event.lat,
                event.lon,
                event.accuracy_m,
                flags,
            ]
        )

        key = (event.employee_id, event.ts_utc.date())
        grouped[key]["employee_name"] = employee.full_name
        grouped[key]["department_name"] = department.name if department is not None else "-"
        grouped[key]["department_id"] = employee.department_id
        grouped[key]["employee_ref"] = employee
        shift_name = (event.flags or {}).get("SHIFT_NAME")
        if isinstance(shift_name, str) and shift_name.strip():
            grouped[key]["shift_name"] = shift_name.strip()
        if event.type == AttendanceType.IN:
            grouped[key]["ins"].append(event)
        else:
            grouped[key]["outs"].append(event)
        for flag_name, flag_value in (event.flags or {}).items():
            if isinstance(flag_value, bool) and flag_value:
                grouped[key]["flags"].add(flag_name)

    events_data_start = events_header_row + 1
    events_data_end = ws_events.max_row
    _style_table_region(
        ws_events,
        header_row=events_header_row,
        data_start_row=events_data_start,
        data_end_row=events_data_end,
        status_col_name="Konum Durumu",
        flags_col_name="Bayraklar",
    )

    for row in ws_events.iter_rows(min_row=events_data_start, max_row=events_data_end):
        if row[5].value is not None:
            row[5].number_format = "yyyy-mm-dd hh:mm"
    _auto_width(ws_events)

    ws_daily = wb.create_sheet("Gunluk Ozet")
    _merge_title(ws_daily, 1, "PUANTAJ GUNLUK OZET RAPORU")
    ws_daily.append(["Tarih Aral\u0131\u011f\u0131", f"{start_date.isoformat()} - {end_date.isoformat()}"])
    ws_daily.append(["Filtre - \u00c7al\u0131\u015fan ID", employee_id if employee_id is not None else "T\u00fcm\u00fc"])
    ws_daily.append(["Filtre - Departman ID", department_id if department_id is not None else "T\u00fcm\u00fc"])
    ws_daily.append([])
    _style_metadata_rows(ws_daily, start_row=2, end_row=4)

    daily_header_row = ws_daily.max_row + 1
    ws_daily.append(
        [
            "Tarih",
            "\u00c7al\u0131\u015fan ID",
            "\u00c7al\u0131\u015fan Ad\u0131",
            "Departman",
            "Vardiya",
            "Giri\u015f",
            "\u00c7\u0131k\u0131\u015f",
            "Saat Aral\u0131\u011f\u0131",
            "\u00c7al\u0131\u015fma S\u00fcresi (saat:dakika)",
            "Mola",
            "Net S\u00fcre",
            "Fazla S\u00fcrelerle \u00c7al\u0131\u015fma",
            "Fazla Mesai",
            "Durum",
            "Bayraklar",
        ]
    )
    _style_header(ws_daily, daily_header_row)

    work_rule_cache: dict[int | None, tuple[int, int]] = {}
    monthly_report_cache: dict[tuple[int, int, int], MonthlyEmployeeResponse] = {}
    monthly_day_lookup_cache: dict[tuple[int, int, int], dict[date, object]] = {}
    monthly_legal_lookup_cache: dict[tuple[int, int, int], dict[date, tuple[int, int]]] = {}

    def _resolve_monthly_context(
        employee_row: Employee,
        day_value: date,
    ) -> tuple[dict[date, object], dict[date, tuple[int, int]]]:
        cache_key = (employee_row.id, day_value.year, day_value.month)
        if cache_key not in monthly_report_cache:
            report = calculate_employee_monthly(
                db,
                employee_id=employee_row.id,
                year=day_value.year,
                month=day_value.month,
            )
            monthly_report_cache[cache_key] = report
            monthly_day_lookup_cache[cache_key] = {item.date: item for item in report.days}
            monthly_legal_lookup_cache[cache_key] = _build_daily_legal_breakdown(
                report,
                contract_weekly_minutes=employee_row.contract_weekly_minutes,
            )
        return monthly_day_lookup_cache[cache_key], monthly_legal_lookup_cache[cache_key]

    total_worked_minutes = 0
    total_extra_work_minutes = 0
    total_overtime_minutes = 0
    for (employee_id_value, day_date), bucket in sorted(grouped.items(), key=lambda item: (item[0][1], item[0][0])):
        ins = bucket["ins"]
        outs = bucket["outs"]
        first_in = ins[0].ts_utc if ins else None
        last_out = outs[-1].ts_utc if outs else None
        employee_ref = bucket.get("employee_ref")
        if not isinstance(employee_ref, Employee):
            continue

        planned_minutes, break_minutes = _work_rule_minutes(
            db,
            bucket["department_id"],
            work_rule_cache,
        )
        day_status, worked_minutes, overtime_minutes = calculate_work_and_overtime(
            first_in_ts=first_in,
            last_out_ts=last_out,
            planned_minutes=planned_minutes,
            break_minutes=break_minutes,
        )
        monthly_day_lookup, monthly_legal_lookup = _resolve_monthly_context(employee_ref, day_date)
        monthly_day = monthly_day_lookup.get(day_date)
        if monthly_day is not None:
            day_status = str(getattr(monthly_day, "status", day_status))
            worked_minutes = max(0, int(getattr(monthly_day, "worked_minutes", worked_minutes)))
        extra_work_minutes, overtime_minutes = monthly_legal_lookup.get(
            day_date,
            (0, max(0, int(overtime_minutes))),
        )
        gross_minutes = _gross_minutes(first_in, last_out)
        break_deducted = max(0, gross_minutes - worked_minutes)
        total_worked_minutes += worked_minutes
        total_extra_work_minutes += extra_work_minutes
        total_overtime_minutes += overtime_minutes
        flag_names = sorted(bucket["flags"])
        if first_in is None:
            flag_names.append("MISSING_IN")
        if last_out is None:
            flag_names.append("MISSING_OUT")

        ws_daily.append(
            [
                day_date,
                employee_id_value,
                bucket["employee_name"],
                bucket["department_name"],
                bucket["shift_name"],
                _to_excel_datetime(first_in),
                _to_excel_datetime(last_out),
                _time_range_label(first_in, last_out),
                _minutes_to_hhmm(gross_minutes),
                _minutes_to_hhmm(break_deducted),
                _minutes_to_hhmm(worked_minutes),
                _minutes_to_hhmm(extra_work_minutes),
                _minutes_to_hhmm(overtime_minutes),
                day_status,
                ", ".join(flag_names) if flag_names else "-",
            ]
        )

    daily_data_start = daily_header_row + 1
    daily_data_end = ws_daily.max_row
    _style_table_region(
        ws_daily,
        header_row=daily_header_row,
        data_start_row=daily_data_start,
        data_end_row=daily_data_end,
    )

    for row in ws_daily.iter_rows(min_row=daily_data_start, max_row=daily_data_end):
        if row[0].value is not None:
            row[0].number_format = "yyyy-mm-dd"
        if row[5].value is not None:
            row[5].number_format = "hh:mm"
        if row[6].value is not None:
            row[6].number_format = "hh:mm"

    ws_daily.append([])
    summary_start = ws_daily.max_row + 1
    ws_daily.append(["Toplam \u00c7al\u0131\u015f\u0131lan Net S\u00fcre", _minutes_to_hhmm(total_worked_minutes)])
    ws_daily.append(["Toplam Fazla S\u00fcrelerle \u00c7al\u0131\u015fma", _minutes_to_hhmm(total_extra_work_minutes)])
    ws_daily.append(["Toplam Fazla Mesai", _minutes_to_hhmm(total_overtime_minutes)])
    _style_metadata_rows(ws_daily, start_row=summary_start, end_row=ws_daily.max_row)
    _auto_width(ws_daily)


def build_puantaj_xlsx_bytes(
    db: Session,
    *,
    mode: ExportMode,
    year: int | None = None,
    month: int | None = None,
    employee_id: int | None = None,
    department_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    include_daily_sheet: bool = True,
    include_inactive: bool = False,
) -> bytes:
    wb = Workbook()

    if mode == "employee":
        if employee_id is None or year is None or month is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="employee_id, year and month are required",
            )
        _build_employee_export(db, wb, employee_id=employee_id, year=year, month=month)
    elif mode in {"department", "all"}:
        if year is None or month is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="year and month are required",
            )
        if mode == "department" and department_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="department_id is required for department export",
            )
        _build_department_or_all_export(
            db,
            wb,
            year=year,
            month=month,
            department_id=department_id if mode == "department" else None,
            include_daily_sheet=include_daily_sheet,
            include_inactive=include_inactive,
        )
    elif mode == "date_range":
        if start_date is None or end_date is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="start_date and end_date are required",
            )
        _build_date_range_export(
            db,
            wb,
            start_date=start_date,
            end_date=end_date,
            employee_id=employee_id,
            department_id=department_id,
        )
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid export mode")

    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


def _fetch_date_range_rows(
    db: Session,
    *,
    start_date: date,
    end_date: date,
    employee_id: int | None,
    department_id: int | None,
) -> list[tuple[AttendanceEvent, Employee, Department | None]]:
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be >= start_date",
        )

    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    stmt = (
        select(AttendanceEvent, Employee, Department)
        .join(Employee, AttendanceEvent.employee_id == Employee.id)
        .outerjoin(Department, Employee.department_id == Department.id)
        .where(
            AttendanceEvent.ts_utc >= start_dt,
            AttendanceEvent.ts_utc < end_dt,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )
    if employee_id is not None:
        stmt = stmt.where(AttendanceEvent.employee_id == employee_id)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)

    return list(db.execute(stmt).all())


def _true_flag_names(flags: dict[str, object] | None) -> str:
    if not flags:
        return "-"
    names = [key for key, value in flags.items() if isinstance(value, bool) and value]
    if not names:
        return "-"
    return ", ".join(sorted(names))


def _write_range_sheet_rows(
    ws: Worksheet,
    *,
    rows: list[tuple[AttendanceEvent, Employee, Department | None]],
) -> None:
    _merge_title(ws, 1, "PUANTAJ TARIH ARALIGI RAPORU")
    ws.append(["Kayıt Sayısı", len(rows)])
    ws.append(["Rapor Üretim (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")])
    ws.append([])
    _style_metadata_rows(ws, start_row=2, end_row=3)

    header_row = ws.max_row + 1
    ws.append(
        [
            "Tarih",
            "Saat (UTC)",
            "Çalışan ID",
            "Çalışan Adı",
            "Departman",
            "Tip",
            "Konum Durumu",
            "Enlem",
            "Boylam",
            "Doğruluk (m)",
            "Bayraklar",
        ]
    )
    _style_header(ws, header_row)

    for event, employee, department in rows:
        ts_value = _to_excel_datetime(event.ts_utc)
        event_date = ts_value.date() if ts_value else None
        ws.append(
            [
                event_date,
                ts_value,
                event.employee_id,
                employee.full_name,
                department.name if department is not None else "-",
                event.type.value,
                event.location_status.value,
                event.lat,
                event.lon,
                event.accuracy_m,
                _true_flag_names(event.flags or {}),
            ]
        )

    data_start = header_row + 1
    data_end = ws.max_row
    _style_table_region(
        ws,
        header_row=header_row,
        data_start_row=data_start,
        data_end_row=data_end,
        status_col_name="Konum Durumu",
        flags_col_name="Bayraklar",
    )

    if ws.max_row >= data_start:
        for row in ws.iter_rows(min_row=data_start, max_row=data_end):
            if row[0].value is not None:
                row[0].number_format = "yyyy-mm-dd"
            if row[1].value is not None:
                row[1].number_format = "hh:mm"
    _auto_width(ws)


def build_puantaj_range_xlsx_bytes(
    db: Session,
    *,
    start_date: date,
    end_date: date,
    mode: RangeSheetMode,
    department_id: int | None = None,
    employee_id: int | None = None,
) -> bytes:
    rows = _fetch_date_range_rows(
        db,
        start_date=start_date,
        end_date=end_date,
        employee_id=employee_id,
        department_id=department_id,
    )
    wb = Workbook()

    if mode == "consolidated":
        ws = wb.active
        ws.title = "Konsolide"
        _write_range_sheet_rows(ws, rows=rows)
    elif mode == "employee_sheets":
        grouped: dict[tuple[int, str], list[tuple[AttendanceEvent, Employee, Department | None]]] = defaultdict(list)
        for row in rows:
            event, employee, _department = row
            grouped[(event.employee_id, employee.full_name)].append(row)

        if not grouped:
            ws = wb.active
            ws.title = "Çalışanlar"
            _write_range_sheet_rows(ws, rows=[])
        else:
            first = True
            for (emp_id, full_name), group_rows in sorted(grouped.items(), key=lambda item: item[0][0]):
                if first:
                    ws = wb.active
                    first = False
                else:
                    ws = wb.create_sheet()
                ws.title = _safe_sheet_title(f"{full_name} ({emp_id})", f"Emp{emp_id}")
                _write_range_sheet_rows(ws, rows=group_rows)
    elif mode == "department_sheets":
        grouped: dict[str, list[tuple[AttendanceEvent, Employee, Department | None]]] = defaultdict(list)
        for row in rows:
            _event, _employee, department = row
            key = department.name if department is not None else "Atanmamış"
            grouped[key].append(row)

        if not grouped:
            ws = wb.active
            ws.title = "Departmanlar"
            _write_range_sheet_rows(ws, rows=[])
        else:
            first = True
            for dep_name, group_rows in sorted(grouped.items(), key=lambda item: item[0].lower()):
                if first:
                    ws = wb.active
                    first = False
                else:
                    ws = wb.create_sheet()
                ws.title = _safe_sheet_title(dep_name, "Departman")
                _write_range_sheet_rows(ws, rows=group_rows)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid range export mode",
        )

    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()
