from __future__ import annotations

import unittest
from datetime import date

from app.models import (
    DepartmentSchedulePlan,
    DepartmentSchedulePlanEmployee,
    SchedulePlanTargetType,
)
from app.services.schedule_plans import plan_applies_to_employee


class SchedulePlanMultiScopeTests(unittest.TestCase):
    def test_only_employee_supports_multiple_targets(self) -> None:
        plan = DepartmentSchedulePlan(
            id=1,
            department_id=10,
            target_type=SchedulePlanTargetType.ONLY_EMPLOYEE,
            target_employee_id=None,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 2, 28),
            is_locked=False,
            is_active=True,
        )
        plan.target_employees = [
            DepartmentSchedulePlanEmployee(employee_id=2),
            DepartmentSchedulePlanEmployee(employee_id=3),
        ]

        self.assertTrue(plan_applies_to_employee(plan, employee_id=2))
        self.assertTrue(plan_applies_to_employee(plan, employee_id=3))
        self.assertFalse(plan_applies_to_employee(plan, employee_id=4))

    def test_department_except_employee_supports_multiple_excludes(self) -> None:
        plan = DepartmentSchedulePlan(
            id=2,
            department_id=10,
            target_type=SchedulePlanTargetType.DEPARTMENT_EXCEPT_EMPLOYEE,
            target_employee_id=None,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 2, 28),
            is_locked=False,
            is_active=True,
        )
        plan.target_employees = [
            DepartmentSchedulePlanEmployee(employee_id=7),
            DepartmentSchedulePlanEmployee(employee_id=9),
        ]

        self.assertFalse(plan_applies_to_employee(plan, employee_id=7))
        self.assertFalse(plan_applies_to_employee(plan, employee_id=9))
        self.assertTrue(plan_applies_to_employee(plan, employee_id=10))

    def test_legacy_single_target_fallback_still_works(self) -> None:
        plan = DepartmentSchedulePlan(
            id=3,
            department_id=10,
            target_type=SchedulePlanTargetType.ONLY_EMPLOYEE,
            target_employee_id=42,
            start_date=date(2026, 2, 1),
            end_date=date(2026, 2, 28),
            is_locked=False,
            is_active=True,
        )
        plan.target_employees = []

        self.assertTrue(plan_applies_to_employee(plan, employee_id=42))
        self.assertFalse(plan_applies_to_employee(plan, employee_id=41))


if __name__ == "__main__":
    unittest.main()
