"""Posting a meeting summary to Slack or Teams by incoming webhook (never without a preview)."""

from __future__ import annotations

from urllib.parse import urlparse

import httpx

from .base import IntegrationError, Kind

#: Webhook hosts we post to. Anything else is refused, so a typo can't leak a summary elsewhere.
HOSTS: dict[str, tuple[str, ...]] = {
    "slack": ("hooks.slack.com",),
    "teams": (
        ".webhook.office.com",
        ".logic.azure.com",
        ".powerplatform.com",
        ".powerautomate.com",
    ),
}


def check_webhook(kind: Kind, url: str) -> str:
    u = urlparse(url.strip())
    host = (u.hostname or "").lower()
    ok = u.scheme == "https" and any(
        host.endswith(h) if h.startswith(".") else host == h for h in HOSTS[kind]
    )
    if not ok:
        names = ", ".join(h.lstrip(".") for h in HOSTS[kind])
        raise IntegrationError(
            f"That isn't a {kind.title()} webhook URL (expected https on {names})."
        )
    return url.strip()


def payload(kind: Kind, text: str) -> dict:
    if kind == "slack":
        return {"text": text, "mrkdwn": True}
    # Teams Workflows ("Post to a channel when a webhook request is received") takes an Adaptive Card.
    return {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [{"type": "TextBlock", "text": text, "wrap": True}],
                },
            }
        ],
    }


class WebhookPoster:
    def __init__(self, kind: Kind, transport=None) -> None:
        self.kind = kind
        self.transport = transport

    async def post(self, creds: dict, text: str) -> None:
        url = check_webhook(self.kind, creds.get("webhook_url", ""))
        async with httpx.AsyncClient(transport=self.transport, timeout=15) as c:
            r = await c.post(url, json=payload(self.kind, text))
        if r.status_code >= 300:
            raise IntegrationError(
                f"{self.kind.title()} refused the post: {r.status_code} {r.text[:200]}"
            )
