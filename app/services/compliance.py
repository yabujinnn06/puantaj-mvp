from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LaborProfile
from app.schemas import LaborProfileUpsertRequest


def get_or_create_labor_profile(db: Session) -> LaborProfile:
    profile = db.scalar(select(LaborProfile).order_by(LaborProfile.id.asc()))
    if profile is not None:
        return profile

    profile = LaborProfile(name="TR_DEFAULT")
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def upsert_labor_profile(db: Session, payload: LaborProfileUpsertRequest) -> LaborProfile:
    profile = db.scalar(select(LaborProfile).order_by(LaborProfile.id.asc()))
    if profile is None:
        profile = LaborProfile(name=payload.name)
        db.add(profile)

    profile.name = payload.name
    profile.weekly_normal_minutes_default = payload.weekly_normal_minutes_default
    profile.daily_max_minutes = payload.daily_max_minutes
    profile.enforce_min_break_rules = payload.enforce_min_break_rules
    profile.night_work_max_minutes_default = payload.night_work_max_minutes_default
    profile.night_work_exceptions_note_enabled = payload.night_work_exceptions_note_enabled
    profile.overtime_annual_cap_minutes = payload.overtime_annual_cap_minutes
    profile.overtime_premium = payload.overtime_premium
    profile.extra_work_premium = payload.extra_work_premium
    profile.overtime_rounding_mode = payload.overtime_rounding_mode

    db.commit()
    db.refresh(profile)
    return profile
