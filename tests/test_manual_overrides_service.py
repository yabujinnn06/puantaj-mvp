from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
import unittest
from unittest.mock import patch

from app.services.manual_overrides import _combine_utc


class ManualOverridesServiceTests(unittest.TestCase):
    def test_combine_utc_uses_attendance_timezone(self) -> None:
        with patch("app.services.manual_overrides._attendance_timezone", return_value=ZoneInfo("Europe/Istanbul")):
            value = _combine_utc(date(2026, 2, 23), "08:30")
        self.assertEqual(value, datetime(2026, 2, 23, 5, 30, tzinfo=timezone.utc))

    def test_combine_utc_none_when_hhmm_missing(self) -> None:
        self.assertIsNone(_combine_utc(date(2026, 2, 23), None))


if __name__ == "__main__":
    unittest.main()
