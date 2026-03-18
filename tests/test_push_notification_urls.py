from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.push_notifications import _with_push_delivery_defaults


class PushNotificationUrlTests(unittest.TestCase):
    def test_relative_url_uses_public_base_url(self) -> None:
        with patch(
            "app.services.push_notifications.get_public_base_url",
            return_value="https://example.com",
        ):
            payload = _with_push_delivery_defaults(
                {"url": "/admin-panel/attendance-extra-checkin-approval?token=demo"}
            )

        self.assertEqual(
            payload["url"],
            "https://example.com/admin-panel/attendance-extra-checkin-approval?token=demo",
        )

    def test_absolute_url_is_preserved(self) -> None:
        with patch(
            "app.services.push_notifications.get_public_base_url",
            return_value="https://example.com",
        ):
            payload = _with_push_delivery_defaults(
                {"url": "https://example.com/admin-panel/notifications?job_id=42"}
            )

        self.assertEqual(
            payload["url"],
            "https://example.com/admin-panel/notifications?job_id=42",
        )


if __name__ == "__main__":
    unittest.main()
