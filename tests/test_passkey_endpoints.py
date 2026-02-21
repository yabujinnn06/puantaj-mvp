from __future__ import annotations

import unittest
from collections.abc import Generator
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import Device


class _FakeDB:
    def add(self, _obj):  # type: ignore[no-untyped-def]
        return None

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None



def _override_get_db(fake_db: _FakeDB):
    def _override() -> Generator[_FakeDB, None, None]:
        yield fake_db

    return _override


class PasskeyEndpointsTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    @patch('app.routers.attendance.log_audit')
    @patch('app.routers.attendance.create_recover_options')
    def test_recover_options_endpoint(self, mock_create_options, _mock_log_audit) -> None:
        challenge = SimpleNamespace(
            id=77,
            expires_at=datetime(2026, 2, 9, 19, 0, 0, tzinfo=timezone.utc),
        )
        mock_create_options.return_value = (challenge, {'challenge': 'abc', 'rpId': 'example.com'})

        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post('/api/device/passkey/recover/options')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['challenge_id'], 77)
        self.assertIn('options', body)
        self.assertEqual(body['options']['challenge'], 'abc')

    @patch('app.routers.attendance.log_audit')
    @patch('app.routers.attendance.verify_recover')
    def test_recover_verify_endpoint(self, mock_verify_recover, _mock_log_audit) -> None:
        device = Device(id=12, employee_id=5, device_fingerprint='fp-test', is_active=True)
        mock_verify_recover.return_value = device

        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            '/api/device/passkey/recover/verify',
            json={
                'challenge_id': 88,
                'credential': {'id': 'cred-test'},
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['ok'], True)
        self.assertEqual(body['employee_id'], 5)
        self.assertEqual(body['device_id'], 12)
        self.assertEqual(body['device_fingerprint'], 'fp-test')

    @patch('app.routers.attendance.log_audit')
    @patch('app.routers.attendance.issue_recovery_codes')
    def test_recovery_code_issue_endpoint(self, mock_issue_recovery_codes, _mock_log_audit) -> None:
        device = Device(id=22, employee_id=9, device_fingerprint='fp-rec-issue', is_active=True)
        expires_at = datetime(2026, 12, 31, 12, 0, 0, tzinfo=timezone.utc)
        mock_issue_recovery_codes.return_value = (
            device,
            ['AB3D-9K2M', 'HT7L-Q2PW'],
            expires_at,
        )

        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            '/api/device/recovery-codes/issue',
            json={'device_fingerprint': 'fp-rec-issue', 'recovery_pin': '123456'},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['ok'])
        self.assertEqual(body['employee_id'], 9)
        self.assertEqual(body['device_id'], 22)
        self.assertEqual(body['code_count'], 2)
        self.assertEqual(body['recovery_codes'], ['AB3D-9K2M', 'HT7L-Q2PW'])

    @patch('app.routers.attendance.recover_device_with_code')
    def test_recovery_code_recover_endpoint(self, mock_recover_with_code) -> None:
        device = Device(id=23, employee_id=10, device_fingerprint='fp-rec-ok', is_active=True)
        mock_recover_with_code.return_value = device

        fake_db = _FakeDB()
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            '/api/device/recovery-codes/recover',
            json={'employee_id': 10, 'recovery_pin': '987654', 'recovery_code': 'AB3D-9K2M'},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['ok'])
        self.assertEqual(body['employee_id'], 10)
        self.assertEqual(body['device_id'], 23)
        self.assertEqual(body['device_fingerprint'], 'fp-rec-ok')


if __name__ == '__main__':
    unittest.main()
