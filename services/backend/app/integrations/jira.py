"""Jira Cloud: your tickets updated since the last standup (REST API v3, email + API token)."""

from __future__ import annotations

import base64
from datetime import UTC, datetime

import httpx

from .base import IntegrationError, Ticket
from .calendars import _parse


class JiraCloud:
    def __init__(self, transport=None) -> None:
        self.transport = transport

    async def updated_since(self, creds: dict, since: float) -> list[Ticket]:
        site = str(creds.get("site", "")).rstrip("/")
        if not site.startswith("https://"):
            raise IntegrationError(
                "Jira site must be an https:// URL, e.g. https://yourteam.atlassian.net"
            )
        auth = base64.b64encode(
            f"{creds.get('email', '')}:{creds.get('api_token', '')}".encode()
        ).decode()
        when = datetime.fromtimestamp(since, UTC).strftime("%Y-%m-%d %H:%M")
        body = {
            "jql": f'assignee = currentUser() AND updated >= "{when}" ORDER BY updated DESC',
            "fields": ["summary", "status", "updated"],
            "maxResults": 20,
        }
        async with httpx.AsyncClient(transport=self.transport, timeout=15) as c:
            r = await c.post(
                f"{site}/rest/api/3/search/jql",
                json=body,
                headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
            )
        if r.status_code in (401, 403):
            raise IntegrationError("Jira rejected the email or API token.", reconnect=True)
        if r.status_code != 200:
            raise IntegrationError(f"Jira: {r.status_code} {r.text[:200]}")
        out = []
        for issue in r.json().get("issues", []):
            f = issue.get("fields", {})
            out.append(
                Ticket(
                    issue["key"],
                    f.get("summary", ""),
                    (f.get("status") or {}).get("name", ""),
                    _parse(f.get("updated")),
                    f"{site}/browse/{issue['key']}",
                )
            )
        return out
