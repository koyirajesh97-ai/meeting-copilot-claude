"""Turn `check --json` results into a GitHub issue body (the nightly job posts it).

uv run python -m app.router.report results.json   # prints the issue title and body, or nothing
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime

from .check import PROBLEMS

TITLE = "Nightly provider check: a provider failed, dropped a model or changed its limits"
WHAT_TO_DO = {
    "fail": "Check the key and the provider's status page; if it's gone for good, take it out of its chains.",
    "model_missing": "Pick the replacement model in config/providers.yaml (and its limits).",
    "limits_changed": "Update the limits in config/providers.yaml so quota warnings stay right.",
}


def issue(results: list[dict], run_url: str = "") -> tuple[str, str] | None:
    bad = [r for r in results if r.get("status") in PROBLEMS]
    if not bad:
        return None
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    lines = [
        f"The nightly check on {day} found {len(bad)} problem(s).",
        "",
        "| Provider | Problem | Detail |",
        "|---|---|---|",
    ]
    lines += [
        f"| `{r['deployment']}` | {r['status']} | {str(r.get('detail', '')).replace('|', '/')[:200]} |"
        for r in bad
    ]
    lines += ["", "What to do:"]
    lines += [f"- **{s}**: {WHAT_TO_DO[s]}" for s in PROBLEMS if any(r["status"] == s for r in bad)]
    ok = sum(r.get("status") == "ok" for r in results)
    lines += [
        "",
        f"{ok} provider(s) were fine; {sum(r.get('status') == 'skipped' for r in results)} were skipped (no key).",
    ]
    if run_url:
        lines += ["", f"Run: {run_url}"]
    return TITLE, "\n".join(lines)


def main() -> int:
    import os

    results = json.loads(open(sys.argv[1]).read())
    run_url = ""
    if os.environ.get("GITHUB_RUN_ID"):
        run_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    out = issue(results, run_url)
    if out:
        print(out[0])
        print(out[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
