from __future__ import annotations

import enum
from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class AttendanceType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class LocationStatus(str, enum.Enum):
    VERIFIED_HOME = "VERIFIED_HOME"
    UNVERIFIED_LOCATION = "UNVERIFIED_LOCATION"
    NO_LOCATION = "NO_LOCATION"


class LeaveType(str, enum.Enum):
    ANNUAL = "ANNUAL"
    SICK = "SICK"
    UNPAID = "UNPAID"
    EXCUSE = "EXCUSE"
    PUBLIC_HOLIDAY = "PUBLIC_HOLIDAY"


class LeaveStatus(str, enum.Enum):
    APPROVED = "APPROVED"
    PENDING = "PENDING"
    REJECTED = "REJECTED"


class AuditActorType(str, enum.Enum):
    ADMIN = "ADMIN"
    SYSTEM = "SYSTEM"


class OvertimeRoundingMode(str, enum.Enum):
    OFF = "OFF"
    REG_HALF_HOUR = "REG_HALF_HOUR"


class AttendanceEventSource(str, enum.Enum):
    DEVICE = "DEVICE"
    MANUAL = "MANUAL"


class SchedulePlanTargetType(str, enum.Enum):
    DEPARTMENT = "DEPARTMENT"
    DEPARTMENT_EXCEPT_EMPLOYEE = "DEPARTMENT_EXCEPT_EMPLOYEE"
    ONLY_EMPLOYEE = "ONLY_EMPLOYEE"


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    departments: Mapped[list[Department]] = relationship(back_populates="region")
    employees: Mapped[list[Employee]] = relationship(back_populates="region")


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    region_id: Mapped[int | None] = mapped_column(
        ForeignKey("regions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    region: Mapped[Region | None] = relationship(back_populates="departments")
    employees: Mapped[list[Employee]] = relationship(back_populates="department")
    work_rule: Mapped[WorkRule | None] = relationship(back_populates="department", uselist=False)
    weekly_rules: Mapped[list[DepartmentWeeklyRule]] = relationship(back_populates="department")
    shifts: Mapped[list[DepartmentShift]] = relationship(back_populates="department")
    schedule_plans: Mapped[list[DepartmentSchedulePlan]] = relationship(back_populates="department")


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    region_id: Mapped[int | None] = mapped_column(
        ForeignKey("regions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
    )
    shift_id: Mapped[int | None] = mapped_column(
        ForeignKey("department_shifts.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    contract_weekly_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    region: Mapped[Region | None] = relationship(back_populates="employees")
    department: Mapped[Department | None] = relationship(back_populates="employees")
    shift: Mapped[DepartmentShift | None] = relationship(back_populates="employees")
    devices: Mapped[list[Device]] = relationship(back_populates="employee")
    device_invites: Mapped[list[DeviceInvite]] = relationship(back_populates="employee")
    leaves: Mapped[list[Leave]] = relationship(back_populates="employee")
    location: Mapped[EmployeeLocation | None] = relationship(back_populates="employee", uselist=False)
    attendance_events: Mapped[list[AttendanceEvent]] = relationship(back_populates="employee")
    manual_day_overrides: Mapped[list[ManualDayOverride]] = relationship(back_populates="employee")
    schedule_plan_targets: Mapped[list[DepartmentSchedulePlan]] = relationship(back_populates="target_employee")
    schedule_plan_scopes: Mapped[list[DepartmentSchedulePlanEmployee]] = relationship(
        back_populates="employee"
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    device_fingerprint: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    employee: Mapped[Employee] = relationship(back_populates="devices")
    attendance_events: Mapped[list[AttendanceEvent]] = relationship(back_populates="device")
    passkeys: Mapped[list[DevicePasskey]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
    )


class DevicePasskey(Base):
    __tablename__ = "device_passkeys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credential_id: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    transports: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    device: Mapped[Device] = relationship(back_populates="passkeys")


class WebAuthnChallenge(Base):
    __tablename__ = "webauthn_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    purpose: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    challenge: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    device: Mapped[Device | None] = relationship()


class DeviceInvite(Base):
    __tablename__ = "device_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    employee: Mapped[Employee] = relationship(back_populates="device_invites")


class EmployeeLocation(Base):
    __tablename__ = "employee_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    home_lat: Mapped[float] = mapped_column(Float, nullable=False)
    home_lon: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[int] = mapped_column(Integer, nullable=False, default=120, server_default=text("120"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    employee: Mapped[Employee] = relationship(back_populates="location")


class WorkRule(Base):
    __tablename__ = "work_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    daily_minutes_planned: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=540,
        server_default=text("540"),
    )
    break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60, server_default=text("60"))
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default=text("5"))

    department: Mapped[Department] = relationship(back_populates="work_rule")


class DepartmentWeeklyRule(Base):
    __tablename__ = "department_weekly_rules"
    __table_args__ = (
        UniqueConstraint("department_id", "weekday", name="uq_department_weekly_rules_department_weekday"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    is_workday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    planned_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=540,
        server_default=text("540"),
    )
    break_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=60,
        server_default=text("60"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department: Mapped[Department] = relationship(back_populates="weekly_rules")


class DepartmentShift(Base):
    __tablename__ = "department_shifts"
    __table_args__ = (
        UniqueConstraint("department_id", "name", name="uq_department_shifts_department_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_time_local: Mapped[time] = mapped_column(Time(timezone=False), nullable=False)
    end_time_local: Mapped[time] = mapped_column(Time(timezone=False), nullable=False)
    break_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=60,
        server_default=text("60"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department: Mapped[Department] = relationship(back_populates="shifts")
    employees: Mapped[list[Employee]] = relationship(back_populates="shift")
    schedule_plans: Mapped[list[DepartmentSchedulePlan]] = relationship(back_populates="shift")


class DepartmentSchedulePlan(Base):
    __tablename__ = "department_schedule_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_type: Mapped[SchedulePlanTargetType] = mapped_column(
        Enum(SchedulePlanTargetType, name="schedule_plan_target_type"),
        nullable=False,
    )
    target_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    shift_id: Mapped[int | None] = mapped_column(
        ForeignKey("department_shifts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    daily_minutes_planned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    break_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grace_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_locked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department: Mapped[Department] = relationship(back_populates="schedule_plans")
    target_employee: Mapped[Employee | None] = relationship(back_populates="schedule_plan_targets")
    shift: Mapped[DepartmentShift | None] = relationship(back_populates="schedule_plans")
    target_employees: Mapped[list[DepartmentSchedulePlanEmployee]] = relationship(
        back_populates="schedule_plan",
        cascade="all, delete-orphan",
    )


class DepartmentSchedulePlanEmployee(Base):
    __tablename__ = "department_schedule_plan_employees"
    __table_args__ = (
        UniqueConstraint(
            "schedule_plan_id",
            "employee_id",
            name="uq_department_schedule_plan_employees_plan_employee",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_plan_id: Mapped[int] = mapped_column(
        ForeignKey("department_schedule_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    schedule_plan: Mapped[DepartmentSchedulePlan] = relationship(back_populates="target_employees")
    employee: Mapped[Employee] = relationship(back_populates="schedule_plan_scopes")


class LaborProfile(Base):
    __tablename__ = "labor_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, default="TR_DEFAULT")
    weekly_normal_minutes_default: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=2700,
        server_default=text("2700"),
    )
    daily_max_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=660,
        server_default=text("660"),
    )
    enforce_min_break_rules: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    night_work_max_minutes_default: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=450,
        server_default=text("450"),
    )
    night_work_exceptions_note_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    overtime_annual_cap_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=16200,
        server_default=text("16200"),
    )
    overtime_premium: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.5,
        server_default=text("1.5"),
    )
    extra_work_premium: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.25,
        server_default=text("1.25"),
    )
    overtime_rounding_mode: Mapped[OvertimeRoundingMode] = mapped_column(
        Enum(OvertimeRoundingMode, name="overtime_rounding_mode"),
        nullable=False,
        default=OvertimeRoundingMode.OFF,
        server_default=text("'OFF'"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Leave(Base):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[LeaveType] = mapped_column(
        Enum(LeaveType, name="leave_type"),
        nullable=False,
    )
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, name="leave_status"),
        nullable=False,
        default=LeaveStatus.APPROVED,
        server_default=text("'APPROVED'"),
    )
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    employee: Mapped[Employee] = relationship(back_populates="leaves")


class ManualDayOverride(Base):
    __tablename__ = "manual_day_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    in_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    out_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_absent: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    rule_source_override: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rule_shift_id_override: Mapped[int | None] = mapped_column(
        ForeignKey("department_shifts.id", ondelete="SET NULL"),
        nullable=True,
    )
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False, default="admin")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    employee: Mapped[Employee] = relationship(back_populates="manual_day_overrides")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    is_super_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    permissions: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    refresh_tokens: Mapped[list[AdminRefreshToken]] = relationship(back_populates="admin_user")


class AdminRefreshToken(Base):
    __tablename__ = "admin_refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jti: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    admin_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="admin", server_default=text("'admin'"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_user_agent: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    admin_user: Mapped[AdminUser | None] = relationship(back_populates="refresh_tokens")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        index=True,
    )
    actor_type: Mapped[AuditActorType] = mapped_column(
        Enum(AuditActorType, name="audit_actor_type"),
        nullable=False,
    )
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )


class NotificationJob(Base):
    __tablename__ = "notification_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    admin_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    job_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    scheduled_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default=text("'PENDING'"),
        index=True,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    employee: Mapped[Employee | None] = relationship()
    admin_user: Mapped[AdminUser | None] = relationship()


class AttendanceEvent(Base):
    __tablename__ = "attendance_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[AttendanceType] = mapped_column(
        Enum(AttendanceType, name="attendance_event_type"),
        nullable=False,
    )
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_status: Mapped[LocationStatus] = mapped_column(
        Enum(LocationStatus, name="attendance_location_status"),
        nullable=False,
    )
    flags: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    source: Mapped[AttendanceEventSource] = mapped_column(
        Enum(AttendanceEventSource, name="attendance_event_source"),
        nullable=False,
        default=AttendanceEventSource.DEVICE,
        server_default=text("'DEVICE'"),
    )
    created_by_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    employee: Mapped[Employee] = relationship(back_populates="attendance_events")
    device: Mapped[Device] = relationship(back_populates="attendance_events")

