"""Load config/providers.yaml. Providers, models, limits and fallback order live only there."""

from __future__ import annotations

import os
from functools import cached_property
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CONFIG_PATH = REPO_ROOT / "config" / "providers.yaml"

TrainsOnData = bool | Literal["unknown"]


class Limits(BaseModel):
    """Free-tier limits for one model. Any limit may be absent (unknown or unlimited)."""

    model_config = ConfigDict(extra="forbid")
    rpm: int | None = None  # requests per minute
    rpd: int | None = None  # requests per day
    tpm: int | None = None  # tokens per minute
    tpd: int | None = None  # tokens per day
    aspd: int | None = None  # audio seconds per day


class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str | None = None
    key_env: str | None = None
    # Unknown is treated as "trains on data": meeting content never goes there.
    trains_on_data: TrainsOnData = "unknown"
    kind: Literal["llm", "stt_stream", "stt_local"] = "llm"
    model: str | None = None  # default model for STT providers
    models: dict[str, Limits] = Field(default_factory=dict)
    # Hour (UTC) when the provider's daily quota resets.
    reset_utc_hour: int = Field(default=0, ge=0, le=23)

    @property
    def api_key(self) -> str | None:
        return os.environ.get(self.key_env) if self.key_env else None


class Deployment(BaseModel):
    """One provider + model in a task's fallback chain, e.g. groq / openai/gpt-oss-20b."""

    model_config = ConfigDict(frozen=True)
    provider: str
    model: str

    @property
    def id(self) -> str:
        return f"{self.provider}/{self.model}"

    @classmethod
    def parse(cls, entry: str) -> Deployment:
        provider, _, model = entry.partition("/")
        if not provider or not model:
            raise ValueError(f"Fallback entry must be provider/model, got {entry!r}")
        return cls(provider=provider, model=model)


class RouterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tasks: dict[str, list[Deployment]]
    timeouts_s: dict[str, float] = Field(default_factory=dict)
    providers: dict[str, ProviderConfig]
    # Cooldown: after this many consecutive failures a deployment rests for cooldown_s.
    failures_before_cooldown: int = 3
    cooldown_s: float = 30.0
    rate_limit_cooldown_s: float = 60.0
    quota_warn_at: float = 0.80
    quota_skip_at: float = 0.95

    @field_validator("tasks", mode="before")
    @classmethod
    def _parse_tasks(cls, v: dict[str, list[str]]) -> dict[str, list[Deployment]]:
        return {
            task: [Deployment.parse(e) if isinstance(e, str) else e for e in chain]
            for task, chain in v.items()
        }

    def model_post_init(self, _ctx: object) -> None:
        for task, chain in self.tasks.items():
            for d in chain:
                if d.provider not in self.providers:
                    raise ValueError(f"Task {task!r} uses unknown provider {d.provider!r}")

    def provider(self, name: str) -> ProviderConfig:
        return self.providers[name]

    def limits(self, d: Deployment) -> Limits:
        return self.providers[d.provider].models.get(d.model, Limits())

    def timeout(self, task: str) -> float:
        return float(self.timeouts_s.get(task, 30.0))

    @cached_property
    def llm_tasks(self) -> list[str]:
        return [t for t in self.tasks if not t.startswith("stt_")]


def load_config(path: Path | str | None = None) -> RouterConfig:
    p = Path(path or os.environ.get("PROVIDERS_CONFIG") or DEFAULT_CONFIG_PATH)
    return RouterConfig.model_validate(yaml.safe_load(p.read_text()))
