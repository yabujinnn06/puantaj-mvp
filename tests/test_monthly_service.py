from datetime import datetime, timezone
import unittest

from app.services.monthly_calc import (
    calculate_day_metrics,
    calculate_weekly_legal_totals,
    calculate_work_and_overtime,
)


class MonthlyServiceTests(unittest.TestCase):
    def test_complete_day_ok(self) -> None:
        first_in = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)
        last_out = datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc)

        status, worked, overtime = calculate_work_and_overtime(
            first_in_ts=first_in,
            last_out_ts=last_out,
            planned_minutes=540,
            break_minutes=60,
        )

        self.assertEqual(status, "OK")
        self.assertEqual(worked, 480)
        self.assertEqual(overtime, 0)

    def test_overtime_calculation(self) -> None:
        first_in = datetime(2026, 2, 1, 8, 0, tzinfo=timezone.utc)
        last_out = datetime(2026, 2, 1, 19, 0, tzinfo=timezone.utc)

        status, worked, overtime = calculate_work_and_overtime(
            first_in_ts=first_in,
            last_out_ts=last_out,
            planned_minutes=540,
            break_minutes=60,
        )

        self.assertEqual(status, "OK")
        self.assertEqual(worked, 600)
        self.assertEqual(overtime, 60)

    def test_break_clamp_to_zero(self) -> None:
        first_in = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)
        last_out = datetime(2026, 2, 1, 9, 30, tzinfo=timezone.utc)

        status, worked, overtime = calculate_work_and_overtime(
            first_in_ts=first_in,
            last_out_ts=last_out,
            planned_minutes=540,
            break_minutes=60,
        )

        self.assertEqual(status, "OK")
        self.assertEqual(worked, 0)
        self.assertEqual(overtime, 0)

    def test_incomplete_when_missing_out(self) -> None:
        first_in = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)

        status, worked, overtime = calculate_work_and_overtime(
            first_in_ts=first_in,
            last_out_ts=None,
            planned_minutes=540,
            break_minutes=60,
        )

        self.assertEqual(status, "INCOMPLETE")
        self.assertEqual(worked, 0)
        self.assertEqual(overtime, 0)

    def test_weekly_overtime_46_hours_is_60_minutes(self) -> None:
        normal, extra_work, overtime = calculate_weekly_legal_totals(
            worked_minutes=46 * 60,
            contract_weekly_minutes=None,
            weekly_normal_minutes=45 * 60,
            overtime_rounding_mode="OFF",
        )

        self.assertEqual(normal, 45 * 60)
        self.assertEqual(extra_work, 0)
        self.assertEqual(overtime, 60)

    def test_contract_40_worked_44_extra_work_only(self) -> None:
        normal, extra_work, overtime = calculate_weekly_legal_totals(
            worked_minutes=44 * 60,
            contract_weekly_minutes=40 * 60,
            weekly_normal_minutes=45 * 60,
            overtime_rounding_mode="OFF",
        )

        self.assertEqual(normal, 40 * 60)
        self.assertEqual(extra_work, 4 * 60)
        self.assertEqual(overtime, 0)

    def test_break_minimum_enforced_for_8_hours(self) -> None:
        first_in = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)
        last_out = datetime(2026, 2, 1, 17, 0, tzinfo=timezone.utc)
        result = calculate_day_metrics(
            first_in_ts=first_in,
            last_out_ts=last_out,
            planned_minutes=540,
            break_minutes=30,
            daily_max_minutes=11 * 60,
            night_work_max_minutes=int(7.5 * 60),
            enforce_min_break=True,
            is_night_shift=False,
        )

        self.assertEqual(result.status, "OK")
        self.assertEqual(result.gross_minutes, 480)
        self.assertEqual(result.effective_break_minutes, 60)
        self.assertTrue(result.min_break_not_met)


if __name__ == "__main__":
    unittest.main()
