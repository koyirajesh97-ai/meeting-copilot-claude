# Meeting Copilot — End-to-End Requirements, Design & Build Prompts

Nov 2, 2026 · @Sai

## Review of the idea

The idea is strong and buildable: a bot-free desktop copilot that listens to any meeting, knows your project and role, helps you live, and leaves a shared project memory afterward. Pieces of it exist in other products, but the combination of project-shared memory, role-aware live help and standup prep is the differentiator. Phase 1 stays as already decided: single user, record, transcribe, summarize, searchable history, with open-source and paid models switchable, working in Teams on Windows and any other meeting app. The build starts free: free hosted AI APIs behind one router with automatic fallback, open-source libraries, and whichever AI coding tool you prefer; paid services come in only as users grow.

### Your asks, mapped to features

| Your ask | How the design handles it |
|---|---|
| Don't know what's going on, too many meetings | Live transcript, a "Catch me up" button (recap of the last 2 or 5 minutes), and a pre-meeting brief from the project's history |
| Hard to follow some accents | Live captions, a "Clarify" button that rewrites the last thing said in plain English, and a project vocabulary of names and terms so the transcriber spells them right |
| Not sure what to say, end up silent | Talking-point cards tied to the current topic, tuned to your role and the meeting type |
| Forget things | Searchable history and "Ask my meetings" across the whole project |
| Asked a question while checking something else | Detects questions aimed at you (your name, role, or systems you own) and shows an answer card in a few seconds, grounded in project data; if there's no good answer, one tap says "I'll follow up" and logs an action item |
| Remember my voice | One-time voice enrollment, plus separate capture of your mic and the meeting's audio, so "you" is known even before enrollment |
| Standup | Type done / doing / blockers before the meeting; get a 30-second script; the card pops up when your name is called |
| Meeting types and my role | Templates per meeting type and a role profile shape both the live help and the summary |
| Projects in sync | A project workspace whose meetings, summaries, decisions and action items are shared with its members |
| End-to-end summary | Summary with decisions, takeaways, action items (owner and due date), blockers and open questions |

### What I added

- **Two-channel capture.** Your microphone and the meeting's audio are recorded as separate streams. That alone tells the app which words are yours, and it is the biggest accuracy win for the least effort.
- **Pre-meeting brief.** Open items from the last meeting, your pending action items, and the agenda if the invite has one.
- **Follow-up parking lot.** Questions you couldn't answer become action items, and the app drafts the follow-up message after the meeting.
- **Three privacy modes.** Cloud, Local-only (nothing leaves the laptop), and Live-only (help during the call, nothing saved).
- **Consent tools.** A visible recording indicator and a one-click consent message to paste into the meeting chat.
- **Phone companion mode.** For laptops where you can't install software, a phone app listens through its own mic and shows the same cards.
- **Integrations later.** Calendar to auto-detect meetings, Jira to pull standup facts.

### What I changed or left out

- "Use the voice of that person" is read as recognizing your voice (and teammates' voices, with their opt-in). Cloning your voice so the app speaks for you is left out: it misleads other attendees and raises consent problems.
- No hidden or "undetectable" mode, and the app is not meant for job interviews or exams.
- Live suggestions come only from your project data and the transcript, with the source shown. If there's nothing to ground an answer, the app says so instead of guessing.
- Don't run it on your client's government meetings until the agency approves it (see Privacy, consent and compliance).

## Problem, goals and users

The app exists so you never leave a meeting confused, never go silent when asked something, and never lose what was decided.

### Problems it solves

- Back-to-back meetings leave no time to prepare or catch up.
- Fast speech and unfamiliar accents make parts of the conversation hard to follow.
- When a question lands while you're looking at something else, there's no time to find the answer.
- Decisions, owners and blockers get forgotten or live only in one person's notes.
- Teammates on the same project each keep separate, partial records.

### Goals for v1 (targets to measure, not promises)

- A summary with action items is ready within 60 seconds of the meeting ending.
- An answer card appears within about 3 seconds of a question aimed at you.
- Standup prep takes under 2 minutes from typed notes.
- Every project member can search any shared meeting from the project.

### Non-goals

- Joining meetings as a bot participant.
- Speaking on your behalf or cloning anyone's voice.
- Covert recording, or use in interviews and exams.
- Replacing the meeting tool itself (Teams, Zoom and the rest stay as they are).

### Users

| User | What they need |
|---|---|
| Individual contributor (you: DevOps/SRE on a client project) | Live help, standup scripts, a memory of every meeting |
| Teammates on the same project | Shared summaries, decisions and action items without taking notes themselves |
| Team lead or manager | A quick read of what was decided and what's blocked, across meetings |

## Functional requirements

The build is split into four phases: Phase 1 records and summarizes, Phase 2 adds live help, Phase 3 adds shared projects, Phase 4 adds the phone companion and integrations.

| ID | Area | Requirement | Phase |
|---|---|---|---|
| FR-01 | Capture | Record your mic and the meeting's audio as two separate channels, from any meeting app (Teams, Zoom, Meet, Webex, phone on speaker) | 1 |
| FR-02 | Capture | Optionally capture only one app's audio (for example, only Teams) on Windows | 1 |
| FR-03 | Capture | Start and stop from a tray icon or hotkey; auto-prompt when a meeting app starts using the mic | 1 |
| FR-04 | Transcript | Live captions with speaker labels, scrollable during the meeting | 1 |
| FR-05 | Transcript | Project vocabulary (names, systems, acronyms) passed to the transcriber to improve spelling | 1 |
| FR-06 | Transcript | Switch transcription engine between paid cloud and local open-source models in settings | 1 |
| FR-07 | Summary | After the meeting: summary, decisions, takeaways, action items (owner, due date), blockers, open questions | 1 |
| FR-08 | Summary | Summary format depends on meeting type (see table below) | 1 |
| FR-09 | History | Searchable list of meetings; full-text and semantic search; "Ask my meetings" chat with cited answers | 1 |
| FR-10 | History | Export a meeting as Markdown or copy the summary for email, Teams or Slack | 1 |
| FR-11 | Profile | Role profile: title, responsibilities, systems you own, current tickets, how you like to speak | 2 |
| FR-12 | Speakers | Enroll your voice once (about 30 seconds of reading); teammates can enroll with their own consent | 2 |
| FR-13 | Speakers | Rename "Speaker 2" to a person once; the app remembers that voice within the project | 2 |
| FR-14 | Live help | Detect questions aimed at you and show an answer card with sources within about 3 seconds | 2 |
| FR-15 | Live help | Topic cards: when the discussion touches your systems or tickets, show the relevant facts | 2 |
| FR-16 | Live help | "Catch me up" button: recap of the last 2 or 5 minutes | 2 |
| FR-17 | Live help | "Clarify" button: rewrite the last statement in plain English and define unfamiliar terms | 2 |
| FR-18 | Live help | "I'll follow up" button: turn an unanswered question into an action item and draft the reply after the meeting | 2 |
| FR-19 | Standup | Before standup, type rough notes; the app produces done / doing / blockers and a 30-second script | 2 |
| FR-20 | Standup | When your name is called, the script card comes to the front | 2 |
| FR-21 | Brief | Pre-meeting brief: open items from the last meeting of this series, your pending action items, the agenda | 2 |
| FR-22 | Projects | Create projects, invite members by email, assign meetings to a project | 3 |
| FR-23 | Projects | Per-meeting visibility: private or shared with the project | 3 |
| FR-24 | Projects | Live transcript and summary sync to project members in real time | 3 |
| FR-25 | Projects | Project knowledge: upload docs or links (runbooks, specs) that ground live answers | 3 |
| FR-26 | Projects | Action-item board per project with owner, status and due date | 3 |
| FR-27 | Privacy | Recording indicator, consent-message button, Live-only mode, Local-only mode, retention settings, delete | 1 to 3 |
| FR-28 | Mobile | Phone companion app: capture by phone mic, show live cards and summaries | 4 |
| FR-29 | Integrations | Calendar sync to auto-create meetings; Jira to pull your ticket updates into standup prep | 4 |
| FR-30 | AI providers | Choose providers and fallback order per AI task, test each key, and see the free quota left today | 1 |
| FR-31 | AI providers | Meeting content goes only to providers that don't train on it; test-only providers need an explicit opt-in | 1 |

### Meeting types

| Meeting type | Live help focuses on | Summary sections |
|---|---|---|
| Standup | Your script; blockers others raise that touch your work | Per person: done, doing, blockers |
| Sprint, code or design review | Questions about your changes, decisions and their reasons | Decisions, feedback, rework items |
| Planning or refinement | Estimates, dependencies, what's assigned to you | Committed items, owners, risks |
| Incident or war room | Timeline, current hypothesis, commands and owners | Timeline, root cause so far, next steps |
| Client or business meeting | Commitments made, numbers mentioned, open asks | Commitments, asks, follow-ups |
| One-on-one or personal | Your talking points, feedback received | Agreements, feedback, follow-ups |
| Research or learning session | Definitions of new terms, links to related docs | Key concepts, questions to dig into |
| Custom | Instructions you write | Sections you define |

Role profiles ship with presets for DevOps/SRE, developer, QA, product owner or scrum master, business analyst and manager, plus a custom profile. The profile decides which questions count as "aimed at you" and the tone of suggested answers.

## Non-functional requirements

Speed is the requirement that shapes everything: captions within a second and answer cards within about 3 seconds, or the live help arrives after the moment has passed. All figures below are targets to test against, not measured results.

| Category | Requirement | Target |
|---|---|---|
| Latency | Speech to caption on screen | 1 s or less (median) |
| Latency | End of a question to answer card | 2.5 s median, 4 s at the 95th percentile |
| Latency | Meeting end to finished summary (60-minute meeting) | 60 s or less |
| Accuracy | Word error rate on your own test recordings, including accented speech | 12% or less |
| Accuracy | "Me vs. others" labeling with two-channel capture | 95% or better |
| Accuracy | Named speakers among enrolled voices | 85% or better |
| Platforms | Desktop | Windows 10 (2004) and 11 first; macOS 14.2+ second |
| Platforms | Meeting apps | Any app that plays audio on the laptop; no per-app integration needed |
| Footprint | Cloud mode on a 16 GB laptop | Under 15% CPU, under 500 MB RAM |
| Reliability | Network drop | Keep recording locally, buffer up to 60 s of audio, reconnect automatically, never lose the local recording |
| Security | Data in transit and at rest | TLS 1.2+; encryption at rest; voiceprints encrypted separately |
| Security | Access | Row-level security by project membership; private meetings visible only to their owner |
| Privacy | Retention | Configurable; default 30 days for audio, transcripts until deleted; one-click delete per meeting |
| Cost | Cloud mode | $0 while building on the free stack; roughly $1 or less per meeting-hour after upgrading (see Impact) |
| Usability | Overlay | Always-on-top panel that never steals keyboard focus; compact mode; hotkeys for Catch me up, Clarify, I'll follow up |
| Accessibility | Captions | Adjustable font size, high-contrast theme, full keyboard use |
| Resilience | Free provider rate-limited or down | Fall back to the next provider within 1.5 s; warn at 80% of any daily free quota |

## System architecture and real-time pipeline

The desktop app streams your mic and the meeting's audio as two channels to one backend, which turns them into captions, speaker labels and answer cards in a few seconds, then writes a summary to the shared database when the meeting ends.

Answer cards are the only path with a hard time limit, so every other stage is built to stay out of their way.

### Latency budget for an answer card (targets)

| Stage | Budget |
|---|---|
| Audio frame to backend | 150 ms |
| End of speech to final transcript | 700 ms |
| Question detection (rules, then fast LLM) | 300 ms |
| Retrieval (pre-warmed when the topic starts) | 200 ms |
| First bullet of the card on screen | 800 ms |
| **Total** | **About 2.2 s** |

## Free AI services and the provider router

Every AI call goes through one provider router that picks a free hosted API for each task, tracks every free quota, and falls back to the next provider on a rate limit. For one user that covers roughly 3 to 6 meeting-hours a day at $0 (estimate below); local models are only the last fallback.

| Task | First choice (free) | Fallbacks, in order | Free limit to design around |
|---|---|---|---|
| Live captions (streaming) | Deepgram Nova-3 streaming on the $200 signup credit; no card, no expiry | Gladia, about 10 free hours a month → Groq whisper-large-v3 on 5 to 10 s chunks → local faster-whisper | Credit covers about 360 meeting-hours with both channels (estimate) |
| Question detection | Groq gpt-oss-20b | local model → rules only | 30 requests/min, 1,000/day, 200K tokens/day (Groq limits); rules filter first so few calls reach the LLM. Groq retired llama-3.1-8b-instant (Nov 2026) |
| Answer cards, Catch up, Clarify, standup script | Groq gpt-oss-20b | Groq gpt-oss-120b → Mistral Free mode → OpenRouter :free models | Groq: 30 requests/min, 1K/day, 8K tokens/min, 200K tokens/day per model; OpenRouter: 20/min, 50/day (Oct 2026 limits) |
| Summaries and "Ask my meetings" | Mistral Free mode; API data isn't used for training | Groq gpt-oss-120b in chunks under 6K tokens → Gemini Flash free tier, test data only | Mistral shows its limits only in your console; Groq's 8K tokens/min forces chunking |
| Embeddings | Small local embedding model (fastembed bge-small-en-v1.5, 384 dims, CPU, about 100 MB; `uv sync --extra embeddings`) | Cloudflare Workers AI bge-small-en-v1.5 (10,000 Neurons/day free) | Local embeddings cost nothing and never hit a quota; the chain is `tasks.embed` in config/providers.yaml |
| Speaker recognition | pyannote (the WeSpeaker ResNet34 embedding model Community-1 uses), local; `uv sync --extra speakers`, needs HF_TOKEN | diarize (Apache 2.0, CPU): not wired yet | No free hosted equivalent; diarization labels come from the transcriber, and each label's audio is matched to enrolled voices (threshold 0.75 in config) |

All the LLM providers above speak the OpenAI chat-completions format, so one client covers them all. Free models and limits change often, so model names live in config, never in code.

### How the router works

1. LiteLLM is the client for every provider. The fallback loop is the app's own (`services/backend/app/router`) so the data-policy guard, quota tracking and provider.switched events sit in one place: each task has an ordered list of deployments, each with its own requests-per-minute and tokens-per-minute limit.
2. On a 429, timeout or error, the call moves to the next deployment, and a deployment that keeps failing goes on a cooldown timer.
3. A quota tracker counts requests, tokens and audio seconds per provider per day in Postgres. It warns at 80% of a daily quota and skips the provider at 95%.
4. Every provider in `config/providers.yaml` carries a `trains_on_data` flag (Deepgram is `false` because every request sends `mip_opt_out=true`; Gladia stays `unknown` until its free-plan terms are checked; `local` is `false`). Each request carries `data_class: meeting | test`; meeting content never goes to a provider flagged true.
5. Live tasks get a short timeout (1.5 s for cards) before falling back, so a slow provider can't stall a card.
6. Streaming transcription uses its own adapters (WebSocket), with the same quota tracking and fallback order.
7. A usage screen shows quota left per provider today and which provider served each card.

**Daily capacity for one user (estimate).** One meeting-hour uses about 30K tokens for detection, 60K for cards and 25K for its summary. Spread across Groq's per-model daily limits plus Mistral, that is roughly 3 to 6 meeting-hours a day. A second active user is the signal to add paid capacity.

**Free keys to create (no card needed):** Deepgram, Groq, Mistral, Hugging Face (for pyannote), plus optional Gemini, OpenRouter and Cloudflare as extra fallbacks.

## API and event contracts

The desktop app, phone app and backend share one contract: a REST API for setup and history, one WebSocket per live meeting, and typed events generated from `packages/shared/schema/events.json`.

### REST API (all routes need the backend token except /health)

| Method and path | Purpose |
|---|---|
| `POST /auth/session` | Exchange the Supabase session for a short-lived backend token |
| `POST /auth/dev-session` | Local development only (`ALLOW_DEV_LOGIN=1`, localhost): a fixed dev user |
| `GET /me`, `GET /me/profile`, `PUT /me/profile`, `GET /profiles/presets` | Current user, role profile (name, aliases, title, responsibilities, systems owned, tickets, speaking style) and presets |
| `GET /meetings/{id}/cards` | Cards shown during a meeting (owner only) and their Used / Not useful flag |
| `GET /projects`, `POST /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`, `DELETE /projects/{id}` | Project management (members see a project; owners edit and delete it; deleting keeps its meetings, as private, with their owners) |
| `GET /projects/{id}/members`, `POST /projects/{id}/members`, `PATCH /projects/{id}/members/{user_id}`, `DELETE /projects/{id}/members/{user_id}` | Members and pending invites; invite by email (added at once if they have an account, else invited by Supabase magic link and added when they first sign in); owners change roles and remove members; anyone can leave; the last owner can't. Leaving a project deletes your voiceprint enrolled for it |
| `GET /projects/{id}/vocabulary`, `PUT /projects/{id}/vocabulary` | Names and terms for transcription and Clarify (owners and members edit; merged into each project meeting's key terms) |
| `POST /projects/{id}/documents` (file), `POST /projects/{id}/links` (URL), `GET /projects/{id}/documents`, `DELETE /projects/{id}/documents/{doc_id}` | Project knowledge: text, Markdown, HTML and (with the `documents` extra) PDF; stored in Supabase Storage (local folder in development), chunked and embedded; search, Ask and answer cards cite them for members only |
| `POST /meetings` | Create a meeting (project, type, title, mode, visibility); returns meeting_id, ws_url, ws_token |
| `GET /meetings?project_id=&q=`, `GET /meetings/{id}` | List and open meetings with transcript, summary and action items |
| `PATCH /meetings/{id}`, `DELETE /meetings/{id}` | Edit title, type, project and visibility (owner only; sharing needs a project you're an owner or member of; `project_id: ""` makes it personal and private); delete everything for a meeting (transcript, search chunks, summaries, cards, action items, decisions, speaker names, consent events; the desktop app also deletes its cached copy and the WAV files) |
| `POST /meetings/{id}/consent`, `GET /meetings/{id}/consent` | Log "announced" or "objection" (owner); the consent log, including pause and resume, for anyone who can read the meeting. Live-only meetings log nothing |
| `GET /me/privacy`, `PUT /me/privacy` | Your privacy settings: `allow_test_providers` (off by default), `retention_days` (null keeps meetings), `consent_message` |
| `GET /providers` | Each provider's `trains_on_data`, whether it runs on this machine (`local`), the tasks that use it, and whether your meeting data may reach it |
| `GET /me/export` | A zip: one Markdown and one JSON file per meeting you recorded, plus `account.json` (profile, settings, enrolled voice names; never a voiceprint) |
| `POST /me/delete` with `{"confirm": "delete my account"}` | Delete your account: meetings, voiceprints, profile, standups, documents you uploaded, memberships. Projects where you're the only member are deleted; where you're the only owner, the next member becomes owner |
| `POST /meetings/{id}/watch` | A short-lived token for the read-only watch socket (members of the meeting's project, while it's live and shared) |
| `POST /meetings/{id}/ws-token` | A fresh short-lived socket token, for reconnecting |
| `POST /meetings/{id}/end` | Close the meeting and queue the summary |
| `GET /meetings/{id}/summary` | Summary status (none, pending, ready, failed) and content |
| `PUT /meetings/{id}/summary` | Save edits; edited action items and decisions replace the summary's (manual ones stay) |
| `POST /meetings/{id}/summary/regenerate` | Rebuild the summary with another template |
| `GET /templates` | Summary templates per meeting type |
| `GET /meetings/{id}/export?format=md&transcript=true` | Markdown export (`transcript=false` for a summary to paste into email or Teams) |
| `POST /speakers/enroll`, `GET /speakers`, `DELETE /speakers/{id}` | Voice enrollment (10–90 s of 16 kHz mono WAV + `consent=true`; the recording isn't kept), your enrollments (never the voiceprint), deletion |
| `POST /meetings/{id}/speakers/{label}/rename` | Name "Speaker 2" for this meeting (no voiceprint) |
| `GET /search?q=`, `POST /ask` | Hybrid search (Postgres full-text + pgvector, merged by reciprocal rank fusion, filtered to meetings you may see); cited answers across meetings, with `found: false` when nothing relevant exists |
| `POST /standup`, `GET /standup/today`, `PUT /standup/today` | Rough notes in; done / doing / blockers and a 30-second script out (one entry per day, editable) |
| `GET /brief?meeting_id=` or `?title=&type=&agenda=` | Pre-meeting brief: your open action items, the last decisions, blockers and open questions of this series (same title apart from dates and numbers, same type), the agenda |
| `GET /action-items?project_id=&filter=all\|mine\|overdue`, `PATCH /action-items/{id}` | Project action-item board from shared meetings (owner, status, due); "mine" matches your name or aliases; members and the meeting owner edit, viewers read |
| `GET /integrations`, `PUT /integrations/{kind}`, `DELETE /integrations/{kind}` | Your integrations (`google`, `microsoft`, `jira`, `slack`, `teams`), each with its own on/off toggle. Jira: site, email and API token (tested when saved). Slack/Teams: an incoming webhook URL on hooks.slack.com, or *.webhook.office.com / *.logic.azure.com (Teams Workflows). Secrets are encrypted with INTEGRATIONS_KEY and never returned |
| `POST /integrations/{google\|microsoft}/connect`, `GET /integrations/oauth/callback` | Calendar sign-in (OAuth authorization code, read-only calendar scope); the desktop opens the URL in your browser |
| `GET /calendar/upcoming?hours=12` | Events from your connected calendars (all-day and cancelled ones left out), each with a guessed meeting type and the meeting already started from it, if any. `POST /meetings` with `calendar_event_id` creates the meeting record from the event: its title, guessed type and agenda (the event description) unless you set them |
| `GET /standup/tickets` | Your Jira tickets updated since the day of your last standup (at most a week); standup prep includes them (Done counts as done, others as doing) |
| `POST /meetings/{id}/share/preview`, `POST /meetings/{id}/share` | Post a summary to Slack or Teams: the preview returns the exact Markdown and a 15-minute preview token; posting needs that token, so nothing is sent without a preview. You can edit the text before confirming |
| `GET /usage` | Free quota left per provider and task today |
| `GET /health`, `GET /metrics` | Liveness and per-stage latency |

### WebSocket `/ws/meetings/{id}?token=…`

- **Audio up:** binary frames; byte 0 is the channel (0 = mic, 1 = system), then 20 ms of 16 kHz mono PCM16 (640 bytes).
- **Controls up:** JSON `{"type": "control", "action": "pause" | "resume" | "catch_up" | "clarify" | "follow_up" | "card_feedback", ...}`, plus a ping every 15 s. `pause` drops audio until `resume`; both are logged as consent events (except in Live-only). `catch_up` takes `minutes` (2, or 5 on a long press); `card_feedback` takes `card_id` and `useful`. Catch me up, Clarify and I'll follow up answer with a card (`kind` catch_up, clarify, follow_up); I'll follow up also saves an action item (source `follow_up`, with the question and who asked), and after the meeting a reply is drafted for it (prompt 7) and shown on Meeting detail.
- **Topic cards** (`kind: topic`) appear when someone mentions one of your systems or tickets and a past meeting has something relevant: at most one per minute, never the same system twice in a meeting.
- **Events down:** JSON events with an increasing `seq`. After a reconnect the client connects with `?token=…&last_seq=N` and the server replays every stored event after N (finals, cards and the rest; partials are not replayed).
- **Several frames per message** are allowed (a replayed backlog): each 641-byte block is one frame.
- **Close codes:** 4401 bad or expired token (get a new one from `POST /meetings/{id}/ws-token`), 4404 meeting not found, 4409 meeting has ended, 1013 client too slow (reconnect with `last_seq`).
- **Error codes** in `error` events: `stt_unavailable` (retryable; the server keeps retrying every 30 s), `bad_audio_frame`, `bad_message`, `not_implemented`.
- `meeting.started.providers` maps `stt_live.mic` and `stt_live.system` to the transcription provider each channel started on.
- Caption times (`start_ms`, `end_ms`) are milliseconds since the meeting started, kept continuous across provider switches and VAD gaps.

### Watch socket `/ws/meetings/{id}/watch?token=…&last_seq=N`

Read-only, for project members watching a teammate's shared meeting live. It carries only `meeting.started`, `transcript.partial`, `transcript.final`, `speaker.identified`, `provider.switched` and `summary.ready`; question detections and cards stay private to the person recording. Audio and controls are ignored. Same replay and close codes as the meeting socket; 4409 once the meeting has ended (its summary is then on the meeting page). Members see shared meetings in their Meetings list with a "Shared" badge and "Watch live" while they're in progress; someone else's meeting is read-only (no summary edits, regenerate or speaker renames).

### Events

| Event | Key fields | Sent when |
|---|---|---|
| `meeting.started` | mode, active providers | Socket opens |
| `transcript.partial` | channel, speaker_id, text, start_ms | Interim words arrive (not stored) |
| `transcript.final` | segment_id, channel, speaker_id, text, start_ms, end_ms | An utterance is final (stored) |
| `speaker.identified` | speaker_id, display_name, confidence | A voice matches an enrolled person |
| `question.detected` | segment_id, addressed_to_me, topic | The detector fires |
| `card.created`, `card.delta` | card_id, kind, text, sources, confidence, provider | A card starts; later bullets stream in as deltas |
| `provider.switched` | task, from, to, reason | The router fell back |
| `quota.warning` | provider, task, percent_used | A daily free quota passes 80% |
| `summary.ready` | summary_id | The summary is saved |
| `error` | code, message, retryable | Anything fails |

Value sets and shapes, as defined in `packages/shared/schema/events.json`:

- `channel`: `mic` (always the user, speaker `me`) or `system` (the meeting's audio).
- `mode`: `cloud`, `local` or `live-only`. `providers` maps each task to the active provider.
- Card `kind`: `answer`, `topic`, `clarify`, `catch_up`, `standup` or `follow_up`.
- A source is `{type: meeting | document | standup | transcript, id, at_ms?}`.
- `card.delta` carries `card_id` and `text` to append, plus optional updated `sources` and `confidence`.
- `confidence` is 0 to 1; `seq`, `ts_ms` and all `*_ms` offsets are non-negative integers.

Example event:

```json
{
  "type": "card.created",
  "seq": 412,
  "meeting_id": "m_123",
  "ts_ms": 1830455123000,
  "card_id": "c_88",
  "kind": "answer",
  "text": "- Prod deploy moved to Thursday after the cert renewal\n- Rollback plan is in the runbook",
  "sources": [{"type": "meeting", "id": "m_101", "at_ms": 734000}],
  "confidence": 0.82,
  "provider": "groq/gpt-oss-20b"
}
```

## The app's own AI prompts

The app sends eight prompts to the free LLMs (the seven below plus `ask`, for "Ask my meetings"; all live in `services/backend/app/prompts/`, where catch-up and follow-up also return JSON). Each is short, because small free models follow short prompts better, returns JSON where the app needs structure, and is told to say "no answer" instead of guessing.

### Rules for all prompts

- Store each prompt as a versioned file in `services/backend/app/prompts/` with `{placeholders}`; never inline prompts in code.
- Ask for JSON and validate it with pydantic; retry once on invalid output, then fall back to the next provider.
- Send only the current project's data; never mix projects.
- Every prompt has fixture tests in `evals/prompts/` that run against the Fake provider in CI and against real free providers on demand.

### 1. Question detector (fast model, runs only after the cheap rules match)

```
SYSTEM: You classify one utterance from a live meeting.
The user is {name} (also called {aliases}), role: {role_title}.
They own: {systems_owned}. Their current tickets: {tickets}.
Return JSON only:
{"is_question": true|false, "addressed_to_me": true|false, "topic": "<3-6 words>"}
addressed_to_me is true only if the utterance names the user or an alias,
asks about something they own, or the speaker just handed the turn to them.
USER: Previous utterances: {last_3_utterances}
Utterance ({speaker}): "{text}"
```

### 2. Answer card

```
SYSTEM: You help {name}, a {role_title}, answer a question in a live meeting.
Use ONLY the facts in CONTEXT. Write at most 3 bullets, each under 15 words,
in first person and in this style: {speaking_style}.
Tag each bullet with its source id, like [s2].
If CONTEXT does not answer the question, return {"bullets": [], "confidence": 0}.
Return JSON: {"bullets": [{"text": "...", "source": "s1"}], "confidence": 0.0-1.0}
USER: QUESTION: {question}
CONTEXT:
[s1] {retrieved_chunk_1}
[s2] Today's standup notes: {standup}
[s3] Last 5 minutes: {recent_transcript}
```

### 3. Catch me up

```
SYSTEM: Someone looked away from a meeting. Summarize the last {minutes} minutes
in at most 4 short bullets: what is being discussed, any decision made,
and anything asked of {name}. Plain English. Only what was said.
USER: TRANSCRIPT:
{segments_with_speaker_names}
```

### 4. Clarify

```
SYSTEM: Rewrite the statement in simple English (short sentences, everyday words)
for a listener who missed it because of speed or accent. Keep names and numbers exact.
Then list up to 3 terms that may be unfamiliar, with a one-line meaning.
Use the PROJECT GLOSSARY first.
Return JSON: {"plain": "...", "terms": [{"term": "...", "meaning": "..."}]}
USER: STATEMENT ({speaker}): "{text}"
PROJECT GLOSSARY: {vocabulary}
```

### 5. Standup script

```
SYSTEM: Turn rough notes into a standup update for {name} ({role_title}).
Return JSON: {"done": [], "doing": [], "blockers": [], "script": "..."}
The script is first person, about 75 words (30 seconds spoken), in this style:
{speaking_style}. Don't add work that isn't in the notes. Keep ticket IDs exact.
USER: NOTES: {notes}
YESTERDAY: {previous_entry}
MY OPEN ACTION ITEMS: {action_items}
```

### 6. Summary (map over chunks under 6K tokens, then reduce)

```
MAP SYSTEM: You read one chunk of a {meeting_type} meeting transcript.
Return JSON: {"decisions": [], "action_items": [{"owner": null, "text": "", "due_date": null}],
"blockers": [], "open_questions": [], "key_points": []}
Use only what is said. owner and due_date stay null unless someone states them.

REDUCE SYSTEM: Merge these chunk extracts into one summary of a {meeting_type} meeting.
Sections: {template_sections}. Remove duplicates, keep owners and dates exactly,
and add a 3-sentence overview. Return JSON matching the summary schema.
```

### 7. Follow-up draft

```
SYSTEM: Draft a short follow-up from {name} answering a question they couldn't
answer live. Use only FACTS. If facts are missing, write a holding reply that says
when they'll have the answer. Under 80 words, friendly and professional.
USER: QUESTION: {question}  ASKED BY: {asker}  FACTS: {facts}
```

## Screens and UX

Ten screens cover the whole app, and the overlay is the one that matters most: it has to help in a glance without ever stealing focus from the meeting.

**Keep it simple.** The main path is: open the app, press Start meeting, join the call, read the summary. The sidebar has one big "Start meeting" button and four places (Meetings, Ask, Projects, Settings). Each screen shows the one or two things you need; everything else is folded away ("More options" on Start meeting, the "More" menu on a meeting, collapsed transcript, Settings tabs with technical items under Advanced). Empty sections aren't shown.

| Screen | Purpose | Key elements |
|---|---|---|
| First-run setup | Ready in a few minutes, no sidebar | Three steps with a progress bar: sign in (emailed code), check audio (5 s, live meters), about you (name and role). An AI-keys step appears only when the backend is missing a required key. Skip anytime |
| Meetings home | Find meetings | Search, the next three calendar meetings with Start, recent meetings, Standup prep |
| Start meeting | Start in one click | A name field, Start recording and Announce; "More options" (folded) holds type, project and sharing, privacy mode, agenda and the consent message; the brief below |
| Overlay | Live help during the meeting | Recording dot and timer, level meters, captions, card stack, Catch me up / Clarify / I'll follow up, provider chip |
| Meeting detail | Review and share | The summary (only sections with content) and Copy summary; a More menu with Edit, Export, Regenerate as another type, Post to Slack/Teams, who can see it, Delete; the transcript folded below (opens at the moment when you come from a citation) |
| Ask my meetings | Find anything said before | Chat with cited answers; a citation opens the meeting at that moment |
| Standup prep | Ready in two minutes | Notes box, generated done / doing / blockers, editable 30-second script |
| Projects | Shared memory | Members and roles, vocabulary, documents, action-item board |
| Settings | Control, in tabs | Account (sign-in, your role, your voice), General (default mode, audio devices, look), Connections (calendar, Jira, Slack/Teams), Privacy (retention, consent message, export, delete; which AI services see meeting data, folded), Advanced (server, sync, updates and diagnostics, hotkeys, run setup again) |
| Phone companion | Capture where the laptop can't | Start and stop, captions, cards, summaries |

### Integrations

- Settings → Connections has a toggle per integration. Each one sits behind an interface (`Calendar`, `Tickets`, `Poster` in `services/backend/app/integrations`) with a Fake used in tests, CI and `COPILOT_FAKE_PROVIDERS=1`.
- Calendars (Google Calendar, Outlook via Microsoft Graph): Meetings home lists upcoming meetings with the guessed type; "Start" opens Start meeting with the title, type and agenda filled in. A desktop notification comes up one minute before an event that hasn't been recorded yet ("starts in a minute"); clicking it opens Start meeting for that event, so you still see the brief and Announce before recording. A meeting record is created when you start recording from the event, never for meetings you don't record.
- Jira: your tickets updated since your last standup appear on Standup prep and go into the generated update.
- Slack and Teams: "Post to Slack/Teams…" on a meeting with a summary shows the exact text first (editable); it posts only when you confirm.

### First-run setup, releases and diagnostics

- First run opens Setup (full window, no sidebar): sign-in (the server address is folded under "Using a different server?"); the free-key wizard only if the backend lacks a required key; a 5-second audio check (the recording indicator is on, nothing is written or sent, and the check's audio is cleared from the replay buffer) with per-channel results and a "Fix" link; name and role with a link to voice enrollment. The default meeting mode and the diagnostics opt-in are in Settings. Every step can be skipped; it never opens again once finished or skipped.
- Free-key wizard: `GET /setup/providers` lists each provider's key variable, whether it's set, the sign-up link (from config/providers.yaml), its data policy and tasks. `POST /setup/keys` tests a key with one tiny request (the same checks as `scripts/check-providers`) and saves it in the backend's `.env` only when the request comes from this computer and the backend was started with `COPILOT_ENV_FILE` (`scripts/dev-up` sets it); otherwise it says which variable to add. The desktop never stores keys.
- Packaging with electron-builder: NSIS for Windows testers (unsigned until a certificate is bought), signed and notarized dmg/zip for macOS once the Apple program is joined, AppImage for Linux. The release workflow smoke-tests each packaged app (starts, shows setup, records with Silero VAD loaded from the archive) and publishes to GitHub Releases; electron-updater installs updates on the next start (Settings toggle, on by default).
- Diagnostics are opt-in (off by default): Sentry crash reports (no request bodies, breadcrumbs or user details) and OpenTelemetry request traces from desktop to backend (W3C `traceparent` on every request; span names have ids replaced). Without a collector, the backend still logs each request's trace id.
- Quality gates: `evals/run.py` (part of `pnpm -w check`) fails on regressions in transcript WER (through the gateway with a provider failure and a reconnect), me-vs-others labeling, named speakers, action-item recall, live cards, and on p95 latency over the PRD budgets. The performance test checks CPU and memory during a recorded meeting (proportional memory, so shared libraries count once); a 60-minute run is `COPILOT_PERF_MINUTES=60`. A nightly job pings every free provider and opens or updates a GitHub issue when one fails, drops a model or reports different limits.

### Phone companion

- Expo (React Native) app in `apps/mobile`, a development build (the microphone module, `@siteed/audio-studio`, is native). Sign in with the emailed code (or the local dev login); the backend token and Supabase session live in the iOS Keychain / Android Keystore. No provider keys on the phone.
- Start: title, project (and "Shared with the project"), meeting type, and "Live-only" if nothing should be saved. A red "REC m:ss" bar is pinned to the top of every tab while the microphone is on.
- The phone mic streams 16 kHz mono PCM16 in 20 ms frames to the same meeting WebSocket as the desktop. Its one channel is sent as `system` (channel 1): a phone hears the whole room, so the backend diarizes it and recognizes your voice from your enrollment instead of treating every word as yours. Up to 60 s of audio is buffered and replayed after a dropped connection, as on the desktop (the reconnect, replay, caption and card logic is shared code in `packages/shared`).
- Live: captions, cards (Used / Not useful / Dismiss), Catch me up (hold for 5 minutes), Clarify, I'll follow up, Stop.
- Recording continues with the screen locked where the OS allows: iOS background audio mode, an Android foreground service with a persistent "Meeting Copilot is recording" notification.
- Meetings (summary, decisions, action items, transcript) and Search are read-only; editing stays on the desktop.
- Look: the same dark slate and indigo style as the desktop overlay, a large round record button, icon tab bar (Record, Meetings, Search, Settings). Builds as an Android APK (`pnpm -C apps/mobile build:apk`, also attached to tagged releases) signed with the debug key for testers; store builds need your own signing keys. iOS builds run on a macOS runner (`.github/workflows/ios.yml`): a Simulator build and an unsigned IPA always, a signed ad-hoc IPA with Apple signing secrets.

### Hosting and production mode

- The backend ships as a Docker image (`services/backend/Dockerfile`, unprivileged user, health check) with a Render Blueprint (`render.yaml`, free plan).
- `COPILOT_ENV=production` makes startup fail with a list of missing or unsafe settings (names only): secrets of 32+ characters, a database, an https Supabase project, a meeting-safe AI key for live captions, summaries and cards, and no dev login or test mode. `/ready` reports whether the database answers.
- Every response carries `nosniff`, `X-Frame-Options: DENY`, `no-referrer` and `no-store`, plus HSTS over https. The dev login also refuses proxied requests, whose client address can be forged.
- The apps' built-in server and Supabase settings live in `config/client.json` (public values only).
- Search runs on keywords alone when no embedding model is available (the model can't be downloaded, or isn't installed), instead of failing; a model that fails to load isn't retried for 10 minutes. The Docker image includes the embedding model.
- The LLM client library loads at startup, so the first live call doesn't spend its budget on it.
- Summaries name the meeting owner by their profile name ("Sai is blocked…"), falling back to "Me" when no name is set; a name given to the mic speaker on the meeting itself wins.
- Per-model request settings live in `config/providers.yaml` (`params`, e.g. `reasoning_effort: low` for the fast tier). Question detection has 1.5 s.

Checked with a real Groq key (Nov 2026): Whisper captions both channels, catch-up cards and a standup summary with per-person done/blockers, decisions and action items, all through Groq alone; question detection answers in 0.3-0.6 s.

### Web app

- `apps/web` runs the desktop screens in a browser, with a browser bridge in place of Electron's main process (same backend client, sign-in, live connection and project/integration calls). Static hosting (Vercel); the backend is hosted separately and allows the site's origin with `COPILOT_WEB_ORIGINS` (CORS is off unless set).
- Audio: the microphone (channel 0) and the meeting's audio from a shared tab or screen (channel 1, Chrome and Edge; "Share tab audio" must be ticked). Without a share, captions come from the mic only and the overlay says it isn't hearing the meeting. Same 16 kHz PCM16 20 ms frames as the desktop.
- The overlay is a floating panel while recording, with the same recording indicator; "Pop out" opens it in an always-on-top Picture-in-Picture window where the browser supports it.
- Nothing is saved in the browser except settings and the short-lived backend token (localStorage); meetings are read from the backend. Local-only mode in a browser keeps nothing (use the desktop app to record to your computer). Exports download as files.
- With no backend built in, the site opens on a "Connect to your server" screen: the address is checked against the server's `/health` before it's saved. There is no sample or demo data.

### Overlay behavior

- **Compact** (default, about 360 × 120 px): recording dot and timer, the last caption line, the newest card's first bullet, and the three action buttons.
- **Expanded** (about 360 × 520 px): scrolling captions with "You" and speaker names, the card stack with sources and Used / Not useful buttons, and a small chip naming the provider that served each card.
- **Card streaming:** the card's first bullet arrives as `card.created`, the rest as `card.delta`. True token streaming from the model is a follow-up (TODO); today each bullet is a delta.
- **Card priority:** an answer to a question aimed at you, then your standup script, then topic cards. At most two cards show; others queue. Cards collapse after 45 s unless pinned.
- **Never steals focus:** the window is always on top but not focusable, so typing in Teams is never interrupted.
- **Hotkeys:** Ctrl/Cmd+Shift plus R (record), C (catch up), L (clarify), F (follow up), E (expand).
- **Readable:** caption size adjustable, light and dark themes, high-contrast option.

## Data model and project sync

Postgres is the single source of truth, and project membership decides who sees what: every shared row carries a project ID, and row-level security filters on it.

| Entity | Key fields | Notes |
|---|---|---|
| users | id, email, name, default_role_profile_id | From the auth provider |
| role_profiles | user_id, title, responsibilities, systems_owned, current_tickets, speaking_style | Drives question detection and answer tone |
| projects | id, name, description, vocabulary[] | Vocabulary feeds the transcriber |
| project_members | project_id, user_id, role (owner, member, viewer) | Basis for row-level security |
| meetings | id, project_id, owner_id, type, title, started_at, ended_at, visibility (private, project), mode (cloud, local, live-only) | One row per recorded session |
| speakers | id, project_id, user_id (nullable), display_name, voiceprint (encrypted), consent_at | A voiceprint is stored only with that person's consent |
| transcript_segments | meeting_id, speaker_id, channel (mic, system), start_ms, end_ms, text, is_final | Streamed in live, finalized after |
| suggestions | meeting_id, kind (answer, topic, clarify, catch-up), trigger_segment_id, text, sources[], used (bool) | Lets you see which suggestions helped |
| summaries | meeting_id, template, sections (JSON), model, created_at | Regenerable with another template; meetings.summary_status tracks the job |
| meeting_speakers | meeting_id, label, display_name | "Speaker 2" renamed for one meeting; text only, never a voiceprint |
| action_items | project_id, meeting_id, owner, text, due_date, due_text, status, source (summary, manual, follow_up), question, asker, draft | Feeds the project board and the next brief; summary items are replaced on regenerate |
| decisions | project_id, meeting_id, text, rationale | Searchable across meetings |
| standup_entries | user_id, project_id, date, done, doing, blockers, script | Typed notes and the generated script |
| documents | project_id, title, source_url or file, uploaded_by | Project knowledge for grounding |
| chunks | source_type, source_id, project_id, text, embedding (vector) | One table for semantic search over transcripts, summaries and docs |
| consent_events | meeting_id, kind (announced, objection, recording paused), at | Audit trail for consent |
| provider_usage | provider, model, task, date, requests, tokens, audio_seconds | Feeds the quota tracker and the usage screen |

### How sync works

1. The desktop app writes to a local SQLite cache (Node's built-in `node:sqlite`, so there's no native module to rebuild for Electron), so recordings and transcripts stay readable offline. Audio is always written to local WAV files first.
2. Transcription runs on the backend, which stores finals in Postgres as they happen. Live finals are also written to the local cache, and a sync worker pulls meetings and transcripts from the backend (on start, after each meeting, every 5 minutes) to fill in anything missed. If the connection drops, the last 60 s of audio are buffered and replayed and the server replays missed events; audio from a longer outage stays in the local WAV only (see TODO).
3. Project members watch a live shared meeting through the backend's read-only watch socket (see "Watch socket") and see captions as they arrive and the summary when it's ready; cards stay with the person recording. (The backend already holds the live stream and the membership check, so this replaces a Supabase Realtime channel: one less service to secure, and the same replay on reconnect.)
4. Private meetings never leave the owner's account; changing a meeting to "project" shares the transcript, summary and action items, never the raw audio unless the owner chooses to.
5. In Local-only mode nothing syncs; the meeting stays on the laptop until the owner exports it.

## Tech stack: free AI APIs first

Build on free hosted AI APIs, open-source libraries and free developer tools. Local models stay wired in only as the last fallback and for Local-only mode, and each piece moves to a paid service by config once users arrive.

| Layer | Use now (free) | Catch | Upgrade later |
|---|---|---|---|
| AI coding tool | Any: Gemini CLI, Codex with ChatGPT Free, GitHub Copilot Free, Cursor or Windsurf free plans, or OpenCode, Aider or Cline with a free API key | Free plans are capped | The paid plan of whichever tool you settle on |
| Desktop app | Electron + React + TypeScript + Vite + Tailwind | MIT | Stays |
| System audio | WASAPI loopback addon on Windows (loopback-capture); getDisplayMedia loopback on macOS | OS APIs | Stays |
| Voice activity detection | Silero VAD | MIT | Stays |
| Live transcription | Deepgram streaming on the $200 signup credit | One-time credit; then the fallback chain | Deepgram pay-as-you-go |
| LLMs (detection, cards, summaries, Ask) | Groq and Mistral Free mode, with OpenRouter :free and Gemini free as fallbacks, all through the LiteLLM router | Daily quotas; Gemini's free tier uses your prompts, so test data only | Paid tiers of the same providers, or Claude / GPT models |
| Embeddings | fastembed with a small local model | About 100 MB, runs on CPU, no quota | A hosted embedding model |
| Speaker recognition | pyannote Community-1 | CC-BY-4.0 (attribution); Hugging Face terms to download | pyannoteAI Precision-2 |
| Backend | Python 3.12, FastAPI, LiteLLM | Open source | Stays |
| Data, auth, realtime | Supabase via the local CLI in development; Supabase Free cloud for first testers | Free cloud: 500 MB database, 1 GB storage, 2 projects, pauses after 7 idle days | Supabase Pro ($25/month) or self-hosted on AWS |
| Backend hosting | Your laptop; share it with testers through a free Cloudflare Tunnel | Laptop must be on | A small VM, Fly.io, Render or AWS ECS |
| Phone companion | Expo (React Native) | Free tier | Paid builds only if needed |
| CI and monitoring | GitHub Actions, OpenTelemetry, Grafana OSS, Sentry free plan | Solo-developer limits | Paid tiers |
| Code signing | None in development (Windows shows a SmartScreen warning) | Testers click through a warning | Certificates when you distribute |
| Local fallback | faster-whisper and Ollama | Slow without a GPU | Not needed once paid APIs are on |

### When to start paying

- The Deepgram credit runs low: switch captions to pay-as-you-go or lean on the free fallback chain.
- Cards miss 2.5 s or the daily LLM quotas run out: move the card task alone to a paid fast model.
- A second active user or a real customer arrives: use paid tiers with proper data-processing terms.
- The database nears 400 MB or the 7-day pause bites: Supabase Pro or self-hosted Postgres.
- You distribute the app: buy code-signing certificates.

## Privacy, consent and compliance

Recording your own meetings is allowed in Texas and Indiana, but anyone dialing in from an all-party-consent state changes the rule, and voiceprints count as biometric data, so consent has to be a built-in feature. This is general information, not legal advice.

### Recording consent

- Texas and Indiana are one-party-consent states: as a participant, your own consent is enough.
- About a dozen states require every participant's consent, including California, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania and Washington.
- When a call crosses state lines, the stricter state's rule is often the one that applies. The safe default is to announce recording in every meeting.

### Voiceprints are biometric identifiers

- Texas's biometric law (CUBI) lists voiceprints and requires notice and consent before capturing one for a commercial purpose.
- Illinois's BIPA also covers voiceprints, requires written consent, and lets individuals sue.
- So: build a voiceprint only for a person who enrolls themselves and ticks a consent box; store it encrypted (its own key, VOICEPRINT_KEY); delete it on request or when they leave the project (a database trigger does this). Unenrolled people stay "Speaker 2" unless someone types their name, and that label is text, not a voiceprint.

### Built-in safeguards

- Visible recording indicator in the overlay and the tray at all times.
- "Announce" on Start meeting copies the consent message (editable there and in Settings; your edit becomes the default) and logs an "announced" consent event, for the meeting being recorded or the next one started within 15 minutes.
- "Pause" in the overlay stops capture at once (nothing written, metered or sent) and logs a "paused" event; "Resume" asks "Resume recording?" first, then logs "resumed". The indicator shows PAUSED meanwhile.
- Live-only mode: help during the call; no WAV files, nothing in the local cache, no transcript, summary, cards or consent rows in the database, and the meeting row and its replay log are deleted when it ends (abandoned ones after 12 hours).
- Local-only mode: transcription with local faster-whisper, LLM tasks only with providers marked `local: true` in config/providers.yaml (Ollama on 127.0.0.1:11434; without it they fail with "install Ollama"), embeddings on this machine, and a "Local" badge in the overlay. The desktop app only connects to a backend on localhost (otherwise it records to the laptop only), and the backend refuses Local-only meetings when its database isn't on localhost. Search and Ask never send excerpts of Local-only meetings to a cloud model. A test fails if any DNS lookup or connection leaves localhost during a Local-only meeting.
- Retention setting (7–365 days or keep): an hourly job deletes older meetings; the desktop app drops them from its cache at the next sync. Per-meeting delete, full account export (zip of Markdown + JSON) and account delete (type "delete my account").
- Secrets in the OS keychain, never in config files; API keys never shipped in the app bundle.

### Free AI services and meeting data

Free tiers treat your data differently. Google's free Gemini tier may use prompts to improve its products, with human review, while Groq doesn't retain inputs by default and Mistral's API data isn't used for training. The router enforces this: real meeting content goes only to providers flagged as not training on it, and test-only providers need an explicit opt-in in Settings (Settings → Privacy → "Which AI services see meeting data" lists every provider's flag; the opt-in is off by default and applies only to your own meetings).

### Your government client work

Meetings at a child-welfare agency are likely to include confidential case information, and sending that audio to third-party AI services almost certainly needs agency approval and contract coverage. Until your manager and the agency's security team approve it in writing, don't run the app on those meetings or install it on agency devices. If they want AI notes there, Microsoft's Facilitator agent in Teams is the in-tenant route, since it stays inside Microsoft 365 and needs a Copilot license. Use your own app on personal, side-project and non-confidential meetings first.

## Impact, metrics and cost

The payoff is fewer missed asks and zero manual notes for you, a shared memory for the team, and a product with a clear gap to fill, at $0 per meeting-hour on the free stack and roughly $0.60 to $1.00 once you upgrade to paid cloud services.

### Impact

- **You:** answer more questions on the spot, never walk out without notes, prep standup in minutes, follow accented speech with captions and Clarify.
- **Team:** one shared record per project, so decisions and action items stop living in one person's head; new members catch up by reading past summaries.
- **Product:** it combines what is split across tools today (see below), which makes it a credible side product if you later open it to others.

### Where it fits against existing tools

| Product | Best at | Gap this app fills |
|---|---|---|
| Granola | Bot-free notes captured on your device and cleaned up after the call | Live help during the call |
| Cluely | Live answers and talking points during calls (Pro listed at $19.99 a month) | Project-shared memory; no "undetectable" mode |
| Teams Facilitator | In-Teams live notes, agenda tracking and recap, visible to the whole meeting | Works outside Teams; help that is private to you and tuned to your role |

### Success metrics

| Metric | Target | How it's measured |
|---|---|---|
| Summary turnaround | 60 s or less after the meeting | Timestamps on the summary job |
| Answer card latency | 2.5 s median | Per-stage traces |
| Cards that helped | Half or more marked "used" | The used flag on suggestions |
| Action items captured | 90% or more vs. a manual check | Eval harness on 10 recorded test meetings |
| Unanswered questions turned into follow-ups | 90% or more | "I'll follow up" events vs. detected questions |
| Standup prep time | 2 minutes or less | Time from opening standup prep to script ready |
| Adoption | 80% of your meetings recorded by week 4 | Meetings per week |

### Running cost per meeting-hour (after upgrading to paid services, approximate)

| Item | Cost per hour | Basis |
|---|---|---|
| Transcription of the meeting's audio | $0.29 to $0.46 | Deepgram Nova-3 streaming at $0.0048/min promotional, $0.0077/min standard |
| Transcription of your mic | About $0.06 to $0.09 | Same rate, sent only while you speak (assumes you talk about 20% of the time) |
| Diarization add-on | About $0.12 | Deepgram add-on, about $0.002/min; skippable once pyannote handles speakers |
| LLM for cards and summary | About $0.10 to $0.30 | Estimate: ~30 short card calls on a fast model plus one summary on a stronger model |
| **Total** | **About $0.60 to $1.00** | At 10 meeting-hours a week, about $25 to $45 a month plus a small hosting bill |

The free stack costs $0 per meeting-hour; its limit is quota, roughly 3 to 6 meeting-hours a day for one user, plus about 360 meeting-hours of captions on the Deepgram credit.

## Risks and mitigations

The two risks most likely to sink the product are live cards that arrive too late or say something wrong; both are handled by grounding, a confidence threshold, and an eval harness from day one.

| Risk | Impact | Mitigation |
|---|---|---|
| Answer cards arrive after the moment has passed | High | Stream the transcript, detect questions on partial text, pre-fetch project context when a topic starts, use a fast model, show the first line of the card early |
| Wrong or made-up answers | High | Answer only from retrieved project data and transcript, show sources, hide cards below a confidence threshold, say "No answer found, tap to follow up" instead of guessing |
| Wrong speaker labels | Medium | Two-channel capture for you vs. others; voiceprints for enrolled people; easy rename that corrects the whole meeting |
| Accents and jargon hurt accuracy | Medium | Project vocabulary sent as key terms; test set with your colleagues' real speech (with consent); compare engines in the eval harness |
| Can't install on a locked-down work laptop | Medium | Phone companion mode; never bypass device policy |
| Consent or biometric-law problems | High | Announce button, indicator, consent log, voiceprints only by self-enrollment, Local-only and Live-only modes |
| Echo or doubled audio when using laptop speakers | Low | Prefer headsets; drop mic segments that match the system channel (echo check) |
| macOS or Windows audio permission changes | Medium | Pin the Electron version, test on each OS update, keep the native capture code isolated behind one interface |
| Cost grows with usage | Low | VAD gating, skip paid diarization once pyannote is stable, cache embeddings, Local-only option |
| Leaning on the app instead of preparing | Low | Pre-meeting brief nudges preparation; cards are short prompts, not scripts to read word for word (standup excepted) |
| Free API quotas run out or change, or a free model disappears | Medium | Router with fallback chains and cooldowns, quota meter with warnings, a nightly check of every provider, local models as the last fallback; upgrade only the piece that hits its limit |
| A free tier uses meeting content for training | High | trains_on_data flag per provider; the router blocks meeting data from flagged providers; those providers get test recordings only |

## Roadmap

Four phases over roughly 14 weeks at a part-time pace, each ending at a gate you can measure before moving on. Prompt numbers refer to the build section below. Phase 1 alone already replaces manual notes, so it's a natural place to pause and use the app for a couple of weeks before building live help.

| Phase | Prompts |
|---|---|
| 1 — Capture, transcript, summary, history | 0–8 |
| 2 — Live help | 9–12 |
| 3 — Projects, sync, privacy modes | 13–14 |
| 4 — Phone, integrations, hardening | 15–17 |

Each prompt's acceptance criteria are its gate.

## Building it with any AI coding tool

The prompts work in any AI coding tool, because the repo itself carries the context: one `AGENTS.md` with the rules, small pointer files for tools that read their own file, and this document saved as `docs/PRD.md`. You can switch tools between prompts without losing anything.

### How to work

1. Create a GitHub repo named `meeting-copilot`. Save this doc as `docs/PRD.md`.
2. Create the free accounts and keys: Deepgram, Groq, Mistral, Hugging Face (accept the pyannote Community-1 terms), and optionally Gemini, OpenRouter, Gladia and Cloudflare.
3. Install the free tools: Docker Desktop, Node with pnpm, Python with uv, the Supabase CLI.
4. Run Prompt 0 in your chosen tool. Then one prompt per branch: paste, review the diff, run the app, merge.
5. For bigger prompts, add "Write a plan in docs/plans/ first and wait for my OK."
6. When a free tool's quota runs out, open the repo in another tool and continue with the same prompt.
7. When any tool repeats a mistake, add a one-line rule to AGENTS.md.

### Repo layout

```
meeting-copilot/
├── AGENTS.md                      # the rules, for every AI tool
├── CLAUDE.md                      # one line: @AGENTS.md
├── GEMINI.md                      # one line: read and follow AGENTS.md
├── .github/copilot-instructions.md   # one line: follow AGENTS.md
├── .cursor/rules/project.mdc      # alwaysApply: follow AGENTS.md
├── config/
│   └── providers.yaml             # free providers, limits, fallback order, data policy
├── docs/
│   ├── PRD.md                     # this document
│   └── plans/                     # plans and TODO.md
├── apps/
│   ├── desktop/                   # Electron + React + TypeScript
│   └── mobile/                    # Expo phone companion
├── services/
│   └── backend/app/
│       ├── api/  ws/  jobs/       # REST, WebSocket, background jobs
│       ├── router/                # provider router, quota tracker, data-policy guard
│       ├── providers/             # STT, speaker ID, embeddings adapters (+ Fakes)
│       └── prompts/               # the app's AI prompts as versioned files
├── packages/shared/               # events.json + generated TS and Python types
├── supabase/migrations/           # SQL + row-level security
├── evals/                         # fixtures and latency/accuracy scripts
└── scripts/                       # dev-up, model and key checks
```

### Build prompts

`AGENTS.md` and `config/providers.yaml` in the repo root are the canonical versions of those files. The build prompts (0–17 and the fix-it prompt) are kept in `docs/plans/build-prompts.md`.
