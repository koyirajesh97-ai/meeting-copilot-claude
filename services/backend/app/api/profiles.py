"""GET/PUT /me/profile and GET /profiles/presets."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth import CurrentUser
from app.profiles.store import PRESETS, RoleProfile
from app.services import services

router = APIRouter()


@router.get("/profiles/presets", response_model=dict[str, RoleProfile])
async def presets(_user: CurrentUser) -> dict[str, RoleProfile]:
    return PRESETS


@router.get("/me/profile", response_model=RoleProfile)
async def get_profile(user: CurrentUser) -> RoleProfile:
    return await services().profiles.get(user.user_id) or RoleProfile()


@router.put("/me/profile", response_model=RoleProfile)
async def put_profile(body: RoleProfile, user: CurrentUser) -> RoleProfile:
    clean = body.model_copy(
        update={
            "aliases": [a.strip() for a in body.aliases if a.strip()],
            "systems_owned": [s.strip() for s in body.systems_owned if s.strip()],
            "current_tickets": [t.strip() for t in body.current_tickets if t.strip()],
        }
    )
    return await services().profiles.put(user.user_id, clean)
