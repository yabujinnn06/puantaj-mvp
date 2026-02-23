from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.services.admin_mfa import (
    _decrypt_secret,
    _encrypt_secret,
    _hotp,
    _normalize_totp_secret,
    is_admin_mfa_enabled,
    verify_admin_totp_code,
)
from app.services.notifications import ARCHIVE_DATA_ENC_PREFIX, decrypt_archive_file_data, encrypt_archive_file_data
from app.settings import get_settings


class SecurityFeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        get_settings.cache_clear()

    def tearDown(self) -> None:
        get_settings.cache_clear()

    def test_admin_totp_verification_with_valid_code(self) -> None:
        fixed_now = datetime(2026, 2, 21, 20, 15, 0, tzinfo=timezone.utc)
        with patch.dict(
            os.environ,
            {
                "ADMIN_MFA_REQUIRED": "true",
                "ADMIN_MFA_TOTP_SECRET": "JBSWY3DPEHPK3PXP",
                "ADMIN_MFA_STEP_SECONDS": "30",
                "ADMIN_MFA_WINDOW_STEPS": "1",
            },
            clear=False,
        ):
            get_settings.cache_clear()
            self.assertTrue(is_admin_mfa_enabled())
            secret = _normalize_totp_secret("JBSWY3DPEHPK3PXP")
            self.assertIsNotNone(secret)
            counter = int(fixed_now.timestamp()) // 30
            valid_code = _hotp(secret, counter, digits=6)  # type: ignore[arg-type]
            self.assertTrue(verify_admin_totp_code(valid_code, now_utc=fixed_now))
            self.assertFalse(verify_admin_totp_code("000000", now_utc=fixed_now))

    def test_archive_file_encrypt_decrypt_roundtrip(self) -> None:
        sample = b"excel-binary-payload"
        with patch.dict(
            os.environ,
            {
                "ARCHIVE_FILE_ENCRYPTION_KEY": "archive-test-key",
                "JWT_SECRET": "jwt-test-secret",
            },
            clear=False,
        ):
            get_settings.cache_clear()
            encrypted = encrypt_archive_file_data(sample)
            self.assertTrue(encrypted.startswith(ARCHIVE_DATA_ENC_PREFIX))
            self.assertNotEqual(encrypted, sample)
            decrypted = decrypt_archive_file_data(encrypted)
            self.assertEqual(decrypted, sample)

    def test_archive_decrypt_backward_compatible_plain_data(self) -> None:
        sample = b"legacy-plain-archive"
        self.assertEqual(decrypt_archive_file_data(sample), sample)

    def test_admin_mfa_secret_decrypt_survives_key_priority_change(self) -> None:
        with patch.dict(
            os.environ,
            {
                "RECOVERY_ADMIN_VAULT_KEY": "",
                "ARCHIVE_FILE_ENCRYPTION_KEY": "",
                "JWT_SECRET": "jwt-old-key",
            },
            clear=False,
        ):
            get_settings.cache_clear()
            encrypted_secret = _encrypt_secret("JBSWY3DPEHPK3PXP")
            self.assertTrue(encrypted_secret.startswith("MFA1:"))

        with patch.dict(
            os.environ,
            {
                "RECOVERY_ADMIN_VAULT_KEY": "vault-new-key",
                "ARCHIVE_FILE_ENCRYPTION_KEY": "",
                "JWT_SECRET": "jwt-old-key",
            },
            clear=False,
        ):
            get_settings.cache_clear()
            decrypted_secret = _decrypt_secret(encrypted_secret)
            self.assertEqual(decrypted_secret, "JBSWY3DPEHPK3PXP")


if __name__ == "__main__":
    unittest.main()
