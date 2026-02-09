from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DepartmentSchedulePlan, Employee, SchedulePlanTargetType


_TARGET_PRIORITY: dict[SchedulePlanTargetType, int] = {
    SchedulePlanTargetType.ONLY_EMPLOYEE: 300,
    SchedulePlanTargetType.DEPARTMENT_EXCEPT_EMPLOYEE: 200,
    SchedulePlanTargetType.DEPARTMENT: 100,
}


def plan_applies_to_employee(
    plan: DepartmentSchedulePlan,
    *,
    employee_id: int,
) -> bool:
    scoped_employee_ids = {item.employee_id for item in (plan.target_employees or [])}
    if plan.target_employee_id is not None:
        scoped_employee_ids.add(plan.target_employee_id)

    if plan.target_type == SchedulePlanTargetType.ONLY_EMPLOYEE:
        return employee_id in scoped_employee_ids
    if plan.target_type == SchedulePlanTargetType.DEPARTMENT_EXCEPT_EMPLOYEE:
        return employee_id not in scoped_employee_ids
    return True


def resolve_best_plan_for_day(
    plans: list[DepartmentSchedulePlan],
    *,
    employee_id: int,
    day_date: date,
) -> DepartmentSchedulePlan | None:
    applicable: list[DepartmentSchedulePlan] = []
    for plan in plans:
        if plan.start_date <= day_date <= plan.end_date and plan_applies_to_employee(plan, employee_id=employee_id):
            applicable.append(plan)

    if not applicable:
        return None

    applicable.sort(
        key=lambda item: (
            _TARGET_PRIORITY[item.target_type],
            item.start_date.toordinal(),
            item.updated_at.timestamp() if item.updated_at else 0.0,
            item.id,
        ),
        reverse=True,
    )
    return applicable[0]


def list_department_plans_in_range(
    db: Session,
    *,
    department_id: int | None,
    start_date: date,
    end_date: date,
) -> list[DepartmentSchedulePlan]:
    if department_id is None:
        return []

    return list(
        db.scalars(
            select(DepartmentSchedulePlan)
            .options(selectinload(DepartmentSchedulePlan.target_employees))
            .where(
                DepartmentSchedulePlan.department_id == department_id,
                DepartmentSchedulePlan.is_active.is_(True),
                DepartmentSchedulePlan.start_date <= end_date,
                DepartmentSchedulePlan.end_date >= start_date,
            )
            .order_by(DepartmentSchedulePlan.id.asc())
        ).all()
    )


def resolve_effective_plan_for_employee_day(
    db: Session,
    *,
    employee: Employee,
    day_date: date,
) -> DepartmentSchedulePlan | None:
    if employee.department_id is None:
        return None
    plans = list_department_plans_in_range(
        db,
        department_id=employee.department_id,
        start_date=day_date,
        end_date=day_date,
    )
    return resolve_best_plan_for_day(plans, employee_id=employee.id, day_date=day_date)
