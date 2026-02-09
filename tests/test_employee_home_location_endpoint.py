import unittest
from collections.abc import Generator

from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models import Device, Employee, EmployeeLocation


class FakeDB:
    def __init__(self, scalar_results: list[object | None]):
        self._scalar_results = scalar_results
        self.added: list[object] = []
        self.committed = False

    def scalar(self, _statement):  # type: ignore[no-untyped-def]
        if not self._scalar_results:
            return None
        return self._scalar_results.pop(0)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True

    def refresh(self, _obj: object) -> None:
        return


def override_get_db(fake_db: FakeDB):
    def _override() -> Generator[FakeDB, None, None]:
        yield fake_db

    return _override


class EmployeeHomeLocationEndpointTests(unittest.TestCase):
    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_home_location_success(self) -> None:
        employee = Employee(id=7, full_name="Test Employee", department_id=None, is_active=True)
        device = Device(employee_id=7, device_fingerprint="fp_test_success", is_active=True)
        device.employee = employee
        fake_db = FakeDB(
            scalar_results=[
                device,
                None,
            ]
        )
        app.dependency_overrides[get_db] = override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            "/api/employee/home-location",
            json={
                "device_fingerprint": "fp_test_success",
                "home_lat": 41.01,
                "home_lon": 29.02,
                "radius_m": 300,
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["ok"], True)
        self.assertEqual(body["employee_id"], 7)
        self.assertEqual(body["home_lat"], 41.01)
        self.assertEqual(body["home_lon"], 29.02)
        self.assertEqual(body["radius_m"], 300)
        self.assertEqual(fake_db.committed, True)
        self.assertIsInstance(fake_db.added[0], EmployeeLocation)

    def test_home_location_conflict_when_already_set(self) -> None:
        employee = Employee(id=8, full_name="Test Employee 2", department_id=None, is_active=True)
        device = Device(employee_id=8, device_fingerprint="fp_test_conflict", is_active=True)
        device.employee = employee
        fake_db = FakeDB(
            scalar_results=[
                device,
                EmployeeLocation(employee_id=8, home_lat=40.0, home_lon=30.0, radius_m=120),
            ]
        )
        app.dependency_overrides[get_db] = override_get_db(fake_db)
        client = TestClient(app)

        response = client.post(
            "/api/employee/home-location",
            json={
                "device_fingerprint": "fp_test_conflict",
                "home_lat": 41.0,
                "home_lon": 29.0,
                "radius_m": 300,
            },
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["error"]["code"], "HOME_LOCATION_ALREADY_SET")


if __name__ == "__main__":
    unittest.main()
