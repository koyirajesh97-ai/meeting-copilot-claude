"""The app's own AI prompts, stored as versioned Markdown files with {placeholders}.

File format:

    ---
    id: summary_map
    version: 1
    vars: [meeting_type, chunk]
    ---
    SYSTEM:
    ...text with {meeting_type}...
    USER:
    ...text with {chunk}...

Only the declared `vars` are substituted, so JSON examples with braces stay as written.
Rendering fails if a declared variable is missing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml

DIR = Path(__file__).parent


@dataclass(frozen=True)
class Prompt:
    id: str
    version: int
    vars: tuple[str, ...]
    system: str
    user: str

    def render(self, **values: object) -> list[dict[str, str]]:
        missing = [v for v in self.vars if v not in values]
        if missing:
            raise KeyError(f"prompt {self.id} needs {missing}")
        unknown = set(values) - set(self.vars)
        if unknown:
            raise KeyError(f"prompt {self.id} has no placeholders {sorted(unknown)}")

        def fill(text: str) -> str:
            for v in self.vars:
                text = text.replace("{" + v + "}", str(values[v]))
            return text

        msgs = [{"role": "system", "content": fill(self.system)}]
        if self.user:
            msgs.append({"role": "user", "content": fill(self.user)})
        return msgs


_FRONT = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def parse(text: str, name: str = "?") -> Prompt:
    m = _FRONT.match(text)
    if not m:
        raise ValueError(f"prompt {name}: missing front matter")
    meta = yaml.safe_load(m.group(1))
    body = m.group(2)
    if "SYSTEM:" not in body:
        raise ValueError(f"prompt {name}: missing SYSTEM:")
    _, rest = body.split("SYSTEM:", 1)
    system, _, user = rest.partition("\nUSER:")
    vars_ = tuple(meta.get("vars") or ())
    used = set(re.findall(r"\{([a-z_][a-z0-9_]*)\}", system + user))
    undeclared = used - set(vars_)
    if undeclared:
        raise ValueError(f"prompt {name}: placeholders not in vars: {sorted(undeclared)}")
    return Prompt(meta["id"], int(meta["version"]), vars_, system.strip(), user.strip())


@cache
def load(name: str) -> Prompt:
    return parse((DIR / f"{name}.md").read_text(), name)


def all_names() -> list[str]:
    return sorted(p.stem for p in DIR.glob("*.md"))
