"""GET /usage: today's usage and free quota left, per provider/model and per task."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth import CurrentUser
from app.router.config import Deployment
from app.router.quota import percent_used
from app.services import services

router = APIRouter()


class TaskUsage(BaseModel):
    task: str
    requests: int
    tokens: int
    audio_seconds: float


class DeploymentUsage(BaseModel):
    provider: str
    model: str
    day: str
    requests: int
    tokens: int
    audio_seconds: float
    limits: dict[str, int]
    percent_used: float | None
    status: str  # ok | warning | exhausted | unknown
    trains_on_data: bool | str
    by_task: list[TaskUsage]


class UsageResponse(BaseModel):
    deployments: list[DeploymentUsage]


@router.get("/usage", response_model=UsageResponse)
async def usage(_user: CurrentUser) -> UsageResponse:
    s = services()
    cfg = s.config
    seen: dict[str, Deployment] = {}
    for chain in cfg.tasks.values():
        for d in chain:
            seen.setdefault(d.id, d)
    out: list[DeploymentUsage] = []
    rows_by_day: dict = {}
    for d in seen.values():
        day = s.quota.day_for(d.provider)
        if day not in rows_by_day:
            rows_by_day[day] = await s.quota.store.rows(day)
        rows = [r for r in rows_by_day[day] if r.provider == d.provider and r.model == d.model]
        total = await s.quota.store.totals(d.provider, d.model, day)
        limits = cfg.limits(d)
        pct = percent_used(total, limits)
        status = (
            "unknown"
            if pct is None
            else "exhausted"
            if pct >= cfg.quota_skip_at
            else "warning"
            if pct >= cfg.quota_warn_at
            else "ok"
        )
        out.append(
            DeploymentUsage(
                provider=d.provider,
                model=d.model,
                day=day.isoformat(),
                requests=total.requests,
                tokens=total.tokens,
                audio_seconds=round(total.audio_seconds, 1),
                limits={
                    k: v for k, v in limits.model_dump(exclude={"params"}).items() if v is not None
                },
                percent_used=None if pct is None else round(pct * 100, 1),
                status=status,
                trains_on_data=cfg.provider(d.provider).trains_on_data,
                by_task=[
                    TaskUsage(
                        task=r.task,
                        requests=r.usage.requests,
                        tokens=r.usage.tokens,
                        audio_seconds=round(r.usage.audio_seconds, 1),
                    )
                    for r in rows
                ],
            )
        )
    return UsageResponse(deployments=out)
