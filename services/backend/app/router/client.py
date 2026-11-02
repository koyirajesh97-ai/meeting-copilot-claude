"""Clients that make one call to one deployment. The router decides which deployment."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .config import Deployment, ProviderConfig


class ProviderError(Exception):
    """A call failed in a way the router should fall back from."""

    def __init__(
        self, message: str, *, status: int | None = None, retry_after: float | None = None
    ):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after

    @property
    def rate_limited(self) -> bool:
        return self.status == 429


@dataclass
class ProviderResponse:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class CompletionClient(Protocol):
    async def complete(
        self,
        deployment: Deployment,
        provider: ProviderConfig,
        messages: list[dict[str, str]],
        *,
        timeout: float,
        json_mode: bool,
    ) -> ProviderResponse: ...


class LiteLLMClient:
    """Every provider here speaks the OpenAI chat-completions format, so one client covers all."""

    async def complete(
        self,
        deployment: Deployment,
        provider: ProviderConfig,
        messages: list[dict[str, str]],
        *,
        timeout: float,
        json_mode: bool,
    ) -> ProviderResponse:
        import litellm

        if not provider.base_url:
            raise ProviderError(f"{deployment.provider} has no base_url")
        key = provider.api_key
        if not key:
            raise ProviderError(f"{provider.key_env} is not set", status=401)
        kwargs: dict[str, Any] = {
            "model": f"openai/{deployment.model}",
            "api_base": provider.base_url,
            "api_key": key,
            "messages": messages,
            "timeout": timeout,
            "num_retries": 0,  # the router owns retries and fallback
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            resp = await litellm.acompletion(**kwargs)
        except Exception as e:  # litellm raises typed errors with status_code
            status = getattr(e, "status_code", None)
            retry_after = None
            headers = getattr(getattr(e, "response", None), "headers", None) or {}
            if "retry-after" in headers:
                try:
                    retry_after = float(headers["retry-after"])
                except ValueError:
                    retry_after = None
            raise ProviderError(
                f"{type(e).__name__}: {e}", status=status, retry_after=retry_after
            ) from e
        usage = getattr(resp, "usage", None)
        hidden = getattr(resp, "_hidden_params", {}) or {}
        return ProviderResponse(
            text=resp.choices[0].message.content or "",
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            headers={
                k.lower(): str(v) for k, v in (hidden.get("additional_headers") or {}).items()
            },
        )


Behavior = str | Exception | Callable[[list[dict[str, str]]], str]


class FakeClient:
    """Scripted responses per deployment id, for tests and CI. Never touches the network.

    Each deployment gets a list of behaviors consumed in order (the last one repeats):
    a string (the reply), an Exception (raised), "timeout" (sleeps past the deadline),
    or a callable(messages) -> reply.
    """

    def __init__(self, script: dict[str, list[Behavior]] | None = None, latency_s: float = 0.0):
        self.script = script or {}
        self.latency_s = latency_s
        self.calls: list[str] = []

    async def complete(
        self,
        deployment: Deployment,
        provider: ProviderConfig,
        messages: list[dict[str, str]],
        *,
        timeout: float,
        json_mode: bool,
    ) -> ProviderResponse:
        self.calls.append(deployment.id)
        steps = self.script.get(deployment.id, ['{"ok": true}' if json_mode else "ok"])
        step = steps.pop(0) if len(steps) > 1 else steps[0]
        if self.latency_s:
            await asyncio.sleep(self.latency_s)
        if step == "timeout":
            await asyncio.sleep(timeout + 5)
        if isinstance(step, Exception):
            raise step
        text = step(messages) if callable(step) else step
        prompt = sum(len(m["content"]) for m in messages) // 4
        return ProviderResponse(text=text, prompt_tokens=prompt, completion_tokens=len(text) // 4)
