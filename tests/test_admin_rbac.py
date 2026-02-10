from __future__ import annotations

import unittest
from collections.abc import Generator
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import AdminUser, Employee
from app.security import hash_password, require_admin, verify_password


def _override_get_db(fake_db):
    def _override() -> Generator[object, None, None]:
        yield fake_db

    return _override


class _FakeLoginDB:
    def __init__(self, admin_user: AdminUser):
        self.admin_user = admin_user
        self.rows: list[object] = []

    def scalar(self, statement):  # type: ignore[no-untyped-def]
        if "admin_users" in str(statement):
            return self.admin_user
        return None

    def add(self, obj: object) -> None:
        self.rows.append(obj)

    def commit(self) -> None:
        return

    def rollback(self) -> None:
        return


class _FakeEmployeeDB:
    def __init__(self, employee: Employee):
        self.employee = employee
        self.rows: list[object] = []

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        if model is Employee and pk == self.employee.id:
            return self.employee
        return None

    def add(self, obj: object) -> None:
        self.rows.append(obj)

    def commit(self) -> None:
        return

    def refresh(self, _obj: object) -> None:
        return


class _FakeAdminUsersDB:
    def __init__(self, admin_user: AdminUser):
        self.admin_user = admin_user
        self.deleted_ids: list[int] = []
        self.rows: list[object] = []

    def get(self, model, pk):  # type: ignore[no-untyped-def]
        if model is AdminUser and pk == self.admin_user.id:
            return self.admin_user
        return None

    def scalar(self, statement):  # type: ignore[no-untyped-def]
        # Used for duplicate username check in update flow.
        if "admin_users.username" in str(statement):
            return None
        return None

    def add(self, obj: object) -> None:
        self.rows.append(obj)

    def commit(self) -> None:
        return

    def refresh(self, _obj: object) -> None:
        return

    def delete(self, obj):  # type: ignore[no-untyped-def]
        if isinstance(obj, AdminUser):
            self.deleted_ids.append(obj.id)


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):  # type: ignore[no-untyped-def]
        return self._rows


class _FakeAdminUsersListDB:
    def __init__(self, rows: list[AdminUser]):
        self.rows = rows

    def scalars(self, statement):  # type: ignore[no-untyped-def]
        if "admin_users" in str(statement):
            return _ScalarResult(self.rows)
        return _ScalarResult([])


class AdminRbacTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_login_accepts_db_admin_user(self) -> None:
        admin_user = AdminUser(
            id=10,
            username="ik_test",
            password_hash=hash_password("StrongPass123!"),
            full_name="IK Test",
            is_active=True,
            is_super_admin=False,
            permissions={"reports": {"read": True, "write": False}},
        )
        fake_db = _FakeLoginDB(admin_user)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            "/api/admin/auth/login",
            json={"username": "ik_test", "password": "StrongPass123!"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("access_token", payload)
        self.assertEqual(payload.get("token_type"), "bearer")

    def test_write_permission_required_for_employee_status_update(self) -> None:
        employee = Employee(id=7, full_name="ReadOnly", department_id=None, is_active=True)
        fake_db = _FakeEmployeeDB(employee)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        app.dependency_overrides[require_admin] = lambda: {
            "sub": "readonly_admin",
            "username": "readonly_admin",
            "role": "admin",
            "iat": 0,
            "exp": 9999999999,
            "jti": "readonly-token",
            "is_super_admin": False,
            "permissions": {
                "employees": {"read": True, "write": False},
            },
        }
        client = TestClient(app)

        response = client.patch(
            "/api/admin/employees/7/active",
            json={"is_active": False},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "FORBIDDEN")

    def test_write_permission_allows_employee_status_update(self) -> None:
        employee = Employee(id=8, full_name="Writer", department_id=None, is_active=True)
        fake_db = _FakeEmployeeDB(employee)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        app.dependency_overrides[require_admin] = lambda: {
            "sub": "writer_admin",
            "username": "writer_admin",
            "role": "admin",
            "iat": 0,
            "exp": 9999999999,
            "jti": "writer-token",
            "is_super_admin": False,
            "permissions": {
                "employees": {"read": True, "write": True},
            },
        }
        client = TestClient(app)

        response = client.patch(
            "/api/admin/employees/8/active",
            json={"is_active": False},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_active"])

    def test_super_admin_can_update_admin_username_and_password(self) -> None:
        admin_user = AdminUser(
            id=21,
            username="ik_user",
            password_hash=hash_password("OldPass123!"),
            full_name="IK User",
            is_active=True,
            is_super_admin=False,
            permissions={"reports": {"read": True, "write": False}},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        fake_db = _FakeAdminUsersDB(admin_user)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        app.dependency_overrides[require_admin] = lambda: {
            "sub": "admin",
            "username": "admin",
            "role": "admin",
            "iat": 0,
            "exp": 9999999999,
            "jti": "super-token",
            "admin_user_id": 1,
            "is_super_admin": True,
            "permissions": {},
        }
        client = TestClient(app)

        response = client.patch(
            "/api/admin/admin-users/21",
            json={
                "username": "ik_ops",
                "password": "NewPass123!",
                "full_name": "IK Operations",
                "is_active": True,
                "is_super_admin": False,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["username"], "ik_ops")
        self.assertEqual(payload["full_name"], "IK Operations")
        self.assertTrue(verify_password("NewPass123!", admin_user.password_hash))

    def test_super_admin_can_delete_admin_user(self) -> None:
        admin_user = AdminUser(
            id=22,
            username="ik_delete",
            password_hash=hash_password("DeletePass123!"),
            full_name="Delete User",
            is_active=True,
            is_super_admin=False,
            permissions={"reports": {"read": True, "write": False}},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        fake_db = _FakeAdminUsersDB(admin_user)
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        app.dependency_overrides[require_admin] = lambda: {
            "sub": "admin",
            "username": "admin",
            "role": "admin",
            "iat": 0,
            "exp": 9999999999,
            "jti": "super-token",
            "admin_user_id": 1,
            "is_super_admin": True,
            "permissions": {},
        }
        client = TestClient(app)

        response = client.delete("/api/admin/admin-users/22")

        self.assertEqual(response.status_code, 204)
        self.assertIn(22, fake_db.deleted_ids)

    def test_admin_users_list_normalizes_legacy_boolean_permissions(self) -> None:
        legacy_admin_user = AdminUser(
            id=31,
            username="legacy_admin",
            password_hash=hash_password("LegacyPass123!"),
            full_name="Legacy Admin",
            is_active=True,
            is_super_admin=False,
            permissions={"reports": True, "employees": False},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        fake_db = _FakeAdminUsersListDB([legacy_admin_user])
        app.dependency_overrides[get_db] = _override_get_db(fake_db)
        app.dependency_overrides[require_admin] = lambda: {
            "sub": "admin",
            "username": "admin",
            "role": "admin",
            "iat": 0,
            "exp": 9999999999,
            "jti": "super-token",
            "admin_user_id": 1,
            "is_super_admin": True,
            "permissions": {},
        }
        client = TestClient(app)

        response = client.get("/api/admin/admin-users")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertTrue(payload[0]["permissions"]["reports"]["read"])
        self.assertTrue(payload[0]["permissions"]["reports"]["write"])
        self.assertFalse(payload[0]["permissions"]["employees"]["read"])
        self.assertFalse(payload[0]["permissions"]["employees"]["write"])


if __name__ == "__main__":
    unittest.main()
