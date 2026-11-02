"""Deterministic stand-ins for the LLM, used with COPILOT_FAKE_PROVIDERS=1 and in tests.

They recognise each of the app's prompts and answer with simple extraction rules over the
prompt's own text (no model, no network), so the whole app can run offline and the evals in CI
exercise the real pipeline: prompts, JSON validation, retries, storage. Quality comes from the
real providers; these only need to be plausible and stable.
"""

from __future__ import annotations

import json
import re

WORD = re.compile(r"[a-z0-9][a-z0-9'-]*")
STOP = set(
    "a an the and or but to of in on at for with is are was were be been it this that what when where who why how "
    "do does did can could would should will i you we they he she my your our me us so about from as by if then "
    "there here up just any some all not no yes ok okay".split()
)
WEEKDAYS = (
    "monday tuesday wednesday thursday friday saturday sunday tomorrow today tonight eod".split()
)


def words(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if w not in STOP and len(w) > 2}


def section(text: str, label: str) -> str:
    """Text after `LABEL:` up to the next ALL-CAPS label (or the end)."""
    m = re.search(rf"{label}:\s*(.*?)(?:\n[A-Z][A-Z ]+:|\Z)", text, re.DOTALL)
    return m.group(1).strip() if m else ""


LINE = re.compile(r"^\[(?P<t>[\d:]+)\]\s*(?P<who>[^:]+):\s*(?P<text>.+)$")


def transcript(text: str) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        m = LINE.match(line.strip())
        if m:
            out.append((m["who"].strip(), m["text"].strip()))
    return out


# ---------- summary ----------

# Phrases that usually introduce an action item (case-insensitive) ...
ACTION_PHRASE = re.compile(
    r"\b(i'll|i will|i'm going to|we'll|we will|can you|could you|please|action item|to-?do|follow up|needs? to)\b",
    re.I,
)
# ... or a named person taking it on ("Alex will add ..."), which needs the capital letter.
ACTION_NAMED = re.compile(r"\b[A-Z][a-z]+ (?:will|is going to)\b")
DECISION = re.compile(
    r"\b(we decided|decided|let's go with|we'll go with|agreed|decision is|we're going with)\b",
    re.I,
)
BLOCKER = re.compile(r"\b(blocked|blocker|waiting on|stuck|can't proceed)\b", re.I)
DONE = re.compile(r"\b(yesterday|finished|done|completed|shipped|merged|fixed)\b", re.I)
DOING = re.compile(r"\b(today|working on|i'll|i will|next|going to)\b", re.I)


def _due(text: str) -> str | None:
    """The due date as said (original casing), or None."""
    m = re.search(
        r"\b(?:by|on|before|until)\s+(\w+day|tomorrow|eod|end of (?:day|week)|\d{4}-\d{2}-\d{2})\b",
        text,
        re.I,
    )
    if m:
        return m.group(1)
    for d in WEEKDAYS:
        m = re.search(rf"\b{d}\b", text, re.I)
        if m:
            return m.group(0)
    return None


def _owner(who: str, text: str) -> str | None:
    if re.search(r"\b(i'll|i will|i'm going to)\b", text, re.I):
        return who
    m = re.search(r"\b([A-Z][a-z]+) (?:will|is going to|can take)\b", text)
    if m and m.group(1).lower() not in STOP:
        return m.group(1)
    m = re.search(r"\b(?i:can|could) you\b.*?,\s*([A-Z][a-z]+)\??$", text)
    return m.group(1) if m else None


def summary_map(text: str) -> str:
    lines = transcript(section(text, "TRANSCRIPT"))
    out: dict = {
        "decisions": [],
        "action_items": [],
        "blockers": [],
        "open_questions": [],
        "key_points": [],
        "per_person": [],
    }
    people: dict[str, dict[str, list[str]]] = {}
    for who, said in lines:
        if ACTION_PHRASE.search(said) or ACTION_NAMED.search(said):
            out["action_items"].append(
                {"owner": _owner(who, said), "text": said, "due_date": _due(said)}
            )
        if DECISION.search(said):
            out["decisions"].append({"text": said, "rationale": ""})
        if BLOCKER.search(said):
            out["blockers"].append(said)
        if said.endswith("?"):
            out["open_questions"].append(said)
        elif len(said.split()) >= 6:
            out["key_points"].append(said)
        p = people.setdefault(who, {"done": [], "doing": [], "blockers": []})
        if BLOCKER.search(said):
            p["blockers"].append(said)
        elif DONE.search(said):
            p["done"].append(said)
        elif DOING.search(said):
            p["doing"].append(said)
    if "standup" in text.lower():
        out["per_person"] = [{"person": who, **v} for who, v in people.items() if any(v.values())]
    return json.dumps(out)


def _dedupe(items: list, key=lambda x: x) -> list:
    seen, out = set(), []
    for it in items:
        k = key(it).strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(it)
    return out


def summary_reduce(text: str) -> str:
    extracts = json.loads(section(text, "EXTRACTS") or "[]")
    merged: dict[str, list] = {
        k: []
        for k in [
            "decisions",
            "action_items",
            "blockers",
            "open_questions",
            "key_points",
            "per_person",
        ]
    }
    for e in extracts:
        for k in merged:
            merged[k].extend(e.get(k, []))
    keys = re.findall(r'"(\w+)" \(([^)]+)\)', section(text, "Sections") or text)
    source_for = {
        "decisions": "decisions",
        "root_cause": "decisions",
        "agreements": "decisions",
        "rework": "action_items",
        "committed": "action_items",
        "owners": "action_items",
        "next_steps": "action_items",
        "commitments": "action_items",
        "follow_ups": "action_items",
        "risks": "blockers",
        "asks": "open_questions",
        "questions": "open_questions",
    }

    def items(src: str) -> list[str]:
        vals = merged.get(src, [])
        return _dedupe([v["text"] if isinstance(v, dict) else v for v in vals])

    actions = _dedupe(merged["action_items"], key=lambda a: a["text"])
    key_points = items("key_points")
    out = {
        "overview": " ".join(key_points[:3]) or "A short meeting with no major points.",
        "sections": [
            {"key": k, "title": t, "items": items(source_for.get(k, "key_points"))} for k, t in keys
        ],
        "decisions": _dedupe(merged["decisions"], key=lambda d: d["text"]),
        "takeaways": key_points[:5],
        "action_items": actions,
        "blockers": items("blockers"),
        "open_questions": items("open_questions"),
        "per_person": merged["per_person"],
    }
    return json.dumps(out)


# ---------- live help ----------


def _system(messages: list[dict[str, str]]) -> str:
    return next((m["content"] for m in messages if m["role"] == "system"), "")


def _user(messages: list[dict[str, str]]) -> str:
    return next((m["content"] for m in messages if m["role"] == "user"), "")


def detector(messages: list[dict[str, str]]) -> str:
    sys_, user = _system(messages), _user(messages)
    m = re.search(r'Utterance \(([^)]*)\): "(.*)"', user, re.DOTALL)
    utter = m.group(2) if m else user
    names = re.search(r"The user is (.+?) \(also called (.*?)\)", sys_)
    owned = re.search(r"They own: (.*?)\. Their current tickets: (.*?)\.\n", sys_)
    targets = []
    if names:
        targets += [names.group(1)] + [a.strip() for a in names.group(2).split(",")]
    if owned:
        targets += [x.strip() for x in (owned.group(1) + "," + owned.group(2)).split(",")]
    low = utter.lower()
    is_q = utter.strip().endswith("?") or bool(
        re.match(r"^(what|when|where|who|why|how|can|could|is|are|do|does|did|will)\b", low)
    )
    to_me = is_q and any(
        t and t.lower() != "none" and re.search(rf"\b{re.escape(t.lower())}\b", low)
        for t in targets
    )
    topic = " ".join(w for w in WORD.findall(low) if w not in STOP)[:40] or "general"
    return json.dumps(
        {"is_question": is_q, "addressed_to_me": bool(to_me), "topic": " ".join(topic.split()[:5])}
    )


def _context_items(text: str, prefix: str) -> list[tuple[str, str]]:
    return re.findall(rf"^\[({prefix}\d+)\]\s*(.+)$", text, re.M)


def _best(question: str, items: list[tuple[str, str]]) -> list[tuple[int, str, str]]:
    q = words(question)
    scored = [(len(q & words(body)), sid, body) for sid, body in items]
    # On ties, prefer excerpts with a time ("at 01:23"): they can be opened at that moment.
    timed = lambda body: bool(re.search(r" at \d{2}:\d{2}", body))  # noqa: E731
    return sorted([s for s in scored if s[0] >= 2], key=lambda s: (-s[0], not timed(s[2])))


def _sentences(body: str) -> list[str]:
    """Sentences of an excerpt, without "[00:12] Speaker 1:" prefixes."""
    body = re.sub(r"\[\d{2}:\d{2}(?::\d{2})?\]\s*[^:]{1,40}:\s*", "\n", body)
    body = (
        body.split(": ", 1)[-1]
        if re.match(r"^[^\n:]{1,80}(?: at \d{2}:\d{2}| \(summary\))?:", body)
        else body
    )
    parts = re.split(r"(?<=[.!?])\s+|\n+", body)
    return [p.strip() for p in parts if len(p.strip().split()) >= 3]


def answer_card(messages: list[dict[str, str]]) -> str:
    user = _user(messages)
    question = section(user, "QUESTION")
    items = _context_items(user, "s")
    # The recent-transcript entry contains the question itself; answer from the other facts first.
    facts = [
        (sid, body)
        for sid, body in items
        if not body.startswith(("Last ", "Today's standup notes: none"))
    ]
    q = words(question)
    scored = sorted(
        ((len(q & words(sent)), sid, sent) for sid, body in facts for sent in _sentences(body)),
        key=lambda x: -x[0],
    )
    best = [x for x in scored if x[0] >= 2]
    if not best:
        return json.dumps({"bullets": [], "confidence": 0})
    bullets, seen = [], set()
    for _score, sid, sent in best:
        if sent.lower() in seen:
            continue
        seen.add(sent.lower())
        bullets.append({"text": " ".join(sent.split()[:14]), "source": sid})
        if len(bullets) == 2:
            break
    return json.dumps({"bullets": bullets, "confidence": 0.8})


def catch_up(messages: list[dict[str, str]]) -> str:
    lines = transcript(section(_user(messages), "TRANSCRIPT"))
    bullets = [f"{who}: {said}" for who, said in lines[-4:]] or ["Nothing has been said yet."]
    return json.dumps({"bullets": bullets})


def clarify(messages: list[dict[str, str]]) -> str:
    user = _user(messages)
    m = re.search(r'STATEMENT \([^)]*\): "(.*)"', user, re.DOTALL)
    stmt = m.group(1) if m else ""
    plain = re.sub(
        r"\b(um+|uh+|like|you know|basically|kind of|sort of)\b,?\s*", "", stmt, flags=re.I
    )
    plain = re.sub(r"\s+", " ", plain).strip()
    gloss = section(user, "PROJECT GLOSSARY")
    terms = [
        t.strip()
        for t in re.split(r"[,;\n]", gloss)
        if t.strip() and t.strip().lower() in stmt.lower()
    ]
    return json.dumps(
        {
            "plain": plain,
            "terms": [
                {
                    "term": t.split("=")[0].strip(),
                    "meaning": (t.split("=", 1)[1].strip() if "=" in t else "A project term."),
                }
                for t in terms[:3]
            ],
        }
    )


def standup(messages: list[dict[str, str]]) -> str:
    notes = section(_user(messages), "NOTES")
    parts = [p.strip(" -•") for p in re.split(r"[\n;]+", notes) if p.strip(" -•")]
    done = [p for p in parts if DONE.search(p) and not BLOCKER.search(p)]
    blockers = [p for p in parts if BLOCKER.search(p)]
    doing = [p for p in parts if p not in done and p not in blockers]
    script = (
        "Yesterday "
        + ("; ".join(done) or "I wrapped up small items")
        + ". Today "
        + ("; ".join(doing) or "I'll continue the same work")
        + ". "
        + ("Blocked on " + "; ".join(blockers) + "." if blockers else "No blockers.")
    )
    return json.dumps({"done": done, "doing": doing, "blockers": blockers, "script": script})


def follow_up(messages: list[dict[str, str]]) -> str:
    user = _user(messages)
    q = section(user, "QUESTION").split("  ASKED BY:")[0]
    facts = user.split("FACTS:", 1)[-1].strip()
    if facts and facts.lower() not in {"none", "[]", ""}:
        draft = f'Following up on your question "{q}": {facts[:300]}'
    else:
        draft = f'Following up on "{q}": I\'m checking and will get back to you by end of day.'
    return json.dumps({"draft": draft})


def ask(messages: list[dict[str, str]]) -> str:
    user = _user(messages)
    best = _best(section(user, "QUESTION"), _context_items(user, "c"))
    if not best:
        return json.dumps({"answer": "", "citations": [], "found": False})
    top = best[:2]
    answer = " ".join(f"{body.split(': ', 1)[-1]} [{sid}]" for _s, sid, body in top)
    return json.dumps({"answer": answer, "citations": [sid for _s, sid, _b in top], "found": True})


DISPATCH = [
    ("You read one chunk", lambda m: summary_map(_user(m) + "\n" + _system(m))),
    ("Merge these chunk extracts", lambda m: summary_reduce(_system(m) + "\n" + _user(m))),
    ("You classify one utterance", detector),
    ("You help ", answer_card),
    ("Someone looked away", catch_up),
    ("Rewrite the statement", clarify),
    ("Turn rough notes", standup),
    ("Draft a short follow-up", follow_up),
    ("You answer questions about past meetings", ask),
]


def fake_responder(task: str, messages: list[dict[str, str]], json_mode: bool) -> str:
    sys_ = _system(messages)
    for marker, fn in DISPATCH:
        if sys_.startswith(marker):
            return fn(messages)
    return '{"ok": true}' if json_mode else "ok"
