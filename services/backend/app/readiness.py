"""Production configuration checks and the readiness probe.

With COPILOT_ENV=production the backend refuses to start until its configuration is safe and
complete, and says exactly what's missing (names only, never values). Elsewhere the same problems
are logged as warnings so local development keeps working with fewer settings.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping

from app.router.config import RouterConfig
from app.secrets import MIN_SECRET_CHARS, fernet_from_secret

log = logging.getLogger("app.readiness")

#: Tasks a real meeting can't do without: live captions, the summary, live cards.
ESSENTIAL_TASKS = ("stt_live", "summary", "card")


def production_mode(env: Mapping[str, str] | None = None) -> bool:
    return (env if env is not None else os.environ).get("COPILOT_ENV", "").lower() == "production"


def _meeting_safe_provider_ready(cfg: RouterConfig, task: str, env: Mapping[str, str]) -> bool:
    """A provider in the task's chain that may receive meeting data and has its key set."""
    for d in cfg.tasks.get(task, []):
        p = cfg.providers[d.provider]
        if p.local or p.trains_on_data is not False:
            continue
        if p.key_env and env.get(p.key_env):
            return True
    return False


def config_problems(env: Mapping[str, str], cfg: RouterConfig) -> list[str]:
    problems: list[str] = []
    secret = env.get("BACKEND_SECRET", "")
    if len(secret) < MIN_SECRET_CHARS:
        problems.append(
            f"BACKEND_SECRET must be set to a random value of {MIN_SECRET_CHARS}+ characters"
        )
    for name, purpose in (("VOICEPRINT_KEY", "voiceprint"), ("INTEGRATIONS_KEY", "integrations")):
        value = env.get(name, "")
        if not value:
            problems.append(
                f"{name} must be set (its own random value, not derived from BACKEND_SECRET)"
            )
            continue
        try:
            fernet_from_secret(value, purpose)
        except RuntimeError:
            problems.append(f"{name} must be a Fernet key or {MIN_SECRET_CHARS}+ random characters")
    if not env.get("DATABASE_URL"):
        problems.append(
            "DATABASE_URL must be set (without it meetings are kept in memory and lost on restart)"
        )
    supabase = env.get("SUPABASE_URL", "")
    if not env.get("SUPABASE_JWT_SECRET") and not supabase.startswith("https://"):
        problems.append("SUPABASE_URL must be the https address of your Supabase project")
    if env.get("ALLOW_DEV_LOGIN") == "1":
        problems.append(
            "ALLOW_DEV_LOGIN must not be set (it signs anyone in as a shared test user)"
        )
    if env.get("COPILOT_FAKE_PROVIDERS") == "1":
        problems.append(
            "COPILOT_FAKE_PROVIDERS must not be set (it replaces the AI with scripted test output)"
        )
    for origin in [o.strip() for o in env.get("COPILOT_WEB_ORIGINS", "").split(",") if o.strip()]:
        if not origin.startswith("https://"):
            problems.append(f"COPILOT_WEB_ORIGINS entries must be https origins, got {origin!r}")
    for task in ESSENTIAL_TASKS:
        if not _meeting_safe_provider_ready(cfg, task, env):
            keys = sorted(
                {
                    cfg.providers[d.provider].key_env or ""
                    for d in cfg.tasks.get(task, [])
                    if cfg.providers[d.provider].trains_on_data is False
                    and not cfg.providers[d.provider].local
                }
                - {""}
            )
            problems.append(f"No AI key for {task}: set one of {', '.join(keys)}")
    return problems


def check_startup(
    env: Mapping[str, str] | None = None, cfg: RouterConfig | None = None
) -> list[str]:
    """Raise in production if the configuration isn't safe; otherwise log what's missing."""
    env = env if env is not None else os.environ
    if cfg is None:
        from app.router.config import load_config

        cfg = load_config()
    problems = config_problems(env, cfg)
    if production_mode(env) and problems:
        raise RuntimeError("Not starting in production:\n  - " + "\n  - ".join(problems))
    for p in problems:
        log.warning("config: %s", p)
    return problems
