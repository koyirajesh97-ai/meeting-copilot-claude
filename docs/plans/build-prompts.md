# Build prompts

Run one prompt per branch. Every prompt starts by reading AGENTS.md and docs/PRD.md, so it works the same in any AI coding tool.

## Prompt 0: Bootstrap the repo — DONE

```
Read docs/PRD.md. Scaffold the monorepo exactly as in its "Repo layout":
- pnpm workspaces for apps/desktop and packages/shared (empty packages that build and test).
- services/backend as a uv Python 3.12 project with FastAPI, litellm, a /health route, pytest, ruff.
- AGENTS.md with the PRD's content word for word. CLAUDE.md containing only "@AGENTS.md".
  GEMINI.md, .github/copilot-instructions.md and .cursor/rules/project.mdc (alwaysApply: true)
  each containing one line telling the tool to read and follow AGENTS.md.
- config/providers.yaml with the PRD's example.
- .env.example: GROQ_API_KEY, MISTRAL_API_KEY, DEEPGRAM_API_KEY, HF_TOKEN, and optional
  GEMINI_API_KEY, OPENROUTER_API_KEY, GLADIA_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, BACKEND_URL. Add .env to .gitignore.
- scripts/dev-up starts Supabase locally (Supabase CLI) and the backend.
- Root script "check" runs all lint and tests; GitHub Actions runs it on push.
Acceptance: pnpm -w check passes; CI is green; README lists the free accounts to create
and every setup step.
```

## Prompt 1: Shared event schema — DONE

```
Read AGENTS.md and docs/PRD.md ("API and event contracts").
Define every event in the Events table in packages/shared/schema/events.json as JSON Schema,
each with type, seq, meeting_id and ts_ms. Generate TypeScript types into packages/shared/src
and pydantic models into services/backend/app/events.py with pnpm -w gen:events.
Add a CI check that fails when generated files are stale, and round-trip tests in both languages.
```

## Prompt 2: Desktop app shell and overlay — DONE

```
Read AGENTS.md and docs/PRD.md ("Screens and UX"). Build apps/desktop with Electron + React +
Vite + Tailwind:
- Tray icon (Start/Stop, Open, Quit) and the hotkeys listed under Overlay behavior.
- Main window with routes for Meetings home, Start meeting, Meeting detail, Ask, Standup prep,
  Projects and Settings (empty states are fine for now).
- Overlay window: always on top, focusable false, draggable, compact and expanded states as
  specified, recording indicator visible whenever capture is on; buttons can be stubs.
- Settings persisted with electron-store; secrets with safeStorage.
- Secure defaults: contextIsolation, sandbox, typed preload bridge, strict CSP.
Acceptance: runs on Windows; the overlay stays above a full-screen Teams window without taking
keyboard focus; a Playwright smoke test opens both windows.
```

## Prompt 3: Two-channel audio capture — DONE (see docs/plans/audio-capture.md)

```
Read AGENTS.md and docs/PRD.md (Tech stack, system audio row). In the desktop main process build
an AudioCapture module with one interface and per-OS implementations:
- Mic channel from the selected input device.
- System channel on Windows via a WASAPI loopback native addon (evaluate loopback-capture), plus
  optional process loopback so only one chosen app (for example Teams) is captured.
- System channel on macOS via getDisplayMedia with setDisplayMediaRequestHandler returning audio
  'loopback'; add NSAudioCaptureUsageDescription to Info.plist; detect a silent stream and show
  a permission help screen.
- Resample both to 16 kHz mono PCM16 in 20 ms frames; Silero VAD on the mic channel so mic frames
  are sent only during speech (+300 ms padding).
- Crash-safe local WAV per channel; 60 s ring buffer replayed after a reconnect.
- Live level meters in the overlay.
Acceptance: a 2-minute call produces two WAVs and correct meters; unit tests cover resampling,
framing, ring buffer and VAD gating.
```

## Prompt 4: Provider router for free AI APIs — DONE

```
Read AGENTS.md and docs/PRD.md ("Free AI services and the provider router").
In services/backend/app/router:
- Load config/providers.yaml and build a LiteLLM Router with one model group per task; deployments
  in the listed order with their rpm and tpm limits; cooldown for deployments that keep failing.
- complete(task, messages, data_class, json_schema=None) -> {text or json, provider, latency_ms}.
  Fall back on 429, timeout (per-task timeouts from config), 5xx or invalid JSON. Emit
  provider.switched when it falls back.
- QuotaTracker: requests, tokens and audio seconds per provider and model per day in Postgres
  (provider_usage) with an in-memory version for tests; reset at each provider's reset time;
  emit quota.warning at 80%; skip the deployment at 95%.
- Data-policy guard: data_class "meeting" never reaches trains_on_data true or unknown; raise a
  clear error when no allowed provider is left.
- An STT adapter registry for stt_live with the same quota and fallback logic: Deepgram
  streaming, Gladia streaming, Groq Whisper on 5-10 s VAD chunks, local faster-whisper, Fake.
- GET /usage returns today's usage per provider and task.
- scripts/check-providers sends one tiny request to every configured provider and prints
  status, latency and remaining quota; run it nightly in CI with secrets.
Acceptance: tests with fake providers that simulate 429s, timeouts, bad JSON and exhausted
quotas prove the fallback order, cooldowns, 80/95% thresholds and the data-policy guard.
```

## Prompt 5: Realtime gateway and live transcription — DONE

```
Read AGENTS.md and docs/PRD.md ("API and event contracts").
- POST /meetings returns meeting_id, ws_url and a short-lived ws_token.
- WebSocket /ws/meetings/{id}: binary audio frames (byte 0 = channel) and JSON controls as
  specified; events down with increasing seq and replay after reconnect.
- One live STT session per channel through the router's stt_live adapters (Deepgram first).
  Send project vocabulary as key terms where the provider supports it. Diarize the system
  channel only; mic-channel text is always speaker "me".
- Emit transcript.partial and transcript.final; switch adapters mid-meeting without dropping
  the client socket and emit provider.switched.
- Per-stage latency to GET /metrics.
Acceptance: pytest with the Fake adapter and a WAV fixture; a manual run with Deepgram shows
captions in under 1 s; forcing a Deepgram failure falls back to the next adapter.
```

## Prompt 6: Database, persistence and live captions — DONE

```
Read AGENTS.md and docs/PRD.md ("Data model and project sync").
- supabase/migrations for every entity in the Data model table plus provider_usage, with
  pgvector, indexes on (project_id) and (meeting_id, start_ms), and row-level security:
  owners see private meetings, project members see visibility='project'. RLS tests included.
- Desktop signs in with Supabase Auth (magic link; local Supabase uses its test inbox) and
  calls POST /auth/session.
- Backend stores final segments and meetings; desktop keeps a SQLite cache (better-sqlite3)
  with a sync worker.
- Overlay captions: partials grey, finals normal, "You" vs speaker names, auto-scroll that
  pauses when the user scrolls up.
Acceptance: record, stop, reopen the app and the transcript is in Meetings home; unplugging the
network mid-meeting loses nothing.
```

## Prompt 7: Summaries by meeting type — DONE

```
Read AGENTS.md and docs/PRD.md (Meeting types table; prompt 6 in "The app's own AI prompts").
- On meeting end, queue a summary job that calls router.complete("summary", ...,
  data_class="meeting") with the map prompt on transcript chunks under 6K tokens, then the
  reduce prompt with the meeting type's sections.
- Validate against the summary JSON schema; owners and dates stay null unless stated.
- Save summaries, action_items and decisions; emit summary.ready.
- Meeting detail screen: editable sections, transcript with timestamps, rename speaker, export
  Markdown, copy for email/Teams, regenerate with another template.
- evals/summaries: 3 fixture transcripts with expected action items; score recall (target 90%).
Acceptance: a 60-minute fixture summarizes in under 60 s with real free providers; CI runs
the eval with the Fake provider.
```

## Prompt 8: Search and "Ask my meetings" — DONE

```
Read AGENTS.md and docs/PRD.md.
- Embedding adapter: fastembed with a small local model by default, Cloudflare Workers AI as an
  option, Fake for tests. After summary.ready, chunk transcript and summary (about 400 tokens,
  50 overlap, keep speaker and timestamps) into chunks with embeddings.
- GET /search: Postgres full-text + pgvector hybrid, filtered by what the user may see.
- POST /ask: retrieve top chunks, call router.complete("ask", ...), cite meeting and timestamp
  for every claim, and say so when nothing relevant exists.
- Desktop: search bar on Meetings home and the Ask screen; citations open the meeting at that
  moment.
Acceptance: "what did we decide about X" on fixtures returns the right meeting with a working
citation.
```

## Prompt 9: Voice enrollment and speaker recognition (Phase 2 starts) — DONE

```
Read AGENTS.md and docs/PRD.md ("Privacy, consent and compliance").
- Enrollment screen: consent text (a voiceprint is biometric data, stored encrypted, deletable),
  a required checkbox, then 30 s of reading a passage. Embed with pyannote Community-1 (HF_TOKEN)
  behind a SpeakerId adapter (diarize as an alternative, Fake for tests). Store encrypted with
  consent_at.
- In meetings, embed each system-channel speaker cluster and match by cosine similarity to
  enrolled project speakers (threshold in config, start at 0.75); emit speaker.identified.
- Rename ("Speaker 2" -> a name) relabels the meeting but never creates a voiceprint.
- Delete my voiceprint; removing a member deletes theirs.
Acceptance: a 3-voice fixture names the 2 enrolled voices and leaves the third unnamed.
```

## Prompt 10: Role profile, question detection and answer cards — DONE

```
Read AGENTS.md and docs/PRD.md (FR-11 to FR-15, latency budget, prompts 1 and 2).
- Role profile screen with presets; fields: title, responsibilities, systems_owned,
  current_tickets, speaking_style, name aliases.
- Detector: cheap rules first (question words, "?", user's name or aliases, owned systems);
  only matches go to router.complete("detect") with prompt 1. Emit question.detected.
- Answer: retrieve from project chunks + last 5 minutes + today's standup + role profile; call
  router.complete("card") with prompt 2. Empty bullets or confidence under the threshold show
  "No grounded answer" with an I'll follow up button.
- Pre-warm retrieval when a topic starts; stream bullets with card.delta; overlay shows sources,
  the provider chip and Used / Not useful.
- Log stage timings; the eval fails if median question-end to card exceeds 2.5 s.
Acceptance: a fixture where the user is asked 3 questions yields 3 cited cards; a question to
someone else yields none; a simulated Groq 429 still produces a card from the fallback.
```

## Prompt 11: Catch me up, Clarify, I'll follow up, topic cards — DONE

```
Read AGENTS.md and docs/PRD.md (prompts 3, 4 and 7).
- Catch me up (hotkey C): last 2 minutes, long-press for 5, via router.complete("catchup").
- Clarify (hotkey L): last statement by another speaker rewritten in plain English plus terms
  from the project vocabulary, via router.complete("clarify").
- I'll follow up (hotkey F): action item from the last detected question; after the meeting,
  a follow-up draft per item with prompt 7, shown on Meeting detail for review.
- Topic cards when a system or ticket from the role profile is mentioned; at most one per
  60 s; dismissible.
Acceptance: each action works in Fake mode and returns in under 3 s with real free providers.
```

## Prompt 12: Standup mode and pre-meeting brief

```
Read AGENTS.md and docs/PRD.md (FR-19 to FR-21, prompt 5).
- Standup prep screen: paste rough notes; router.complete("standup") returns done / doing /
  blockers and a 30-second script; user edits; save to standup_entries.
- In a standup meeting, detect the user's turn (name or alias called, e.g. "over to <name>",
  "<name>, go ahead") and bring the script card to the front.
- Pre-meeting brief (GET /brief): the user's open action items, last decisions and blockers from
  the same series, and the agenda if given.
- Standup summaries list done / doing / blockers per person.
Acceptance: a fixture standup shows the script card on the user's turn only; the brief shows
items from the previous fixture meeting.
```

## Prompt 13: Projects and team sync (Phase 3)

```
Read AGENTS.md and docs/PRD.md ("Data model and project sync", FR-22 to FR-26).
- Projects CRUD; invite by email (magic link); roles owner / member / viewer.
- Assign meetings to projects; visibility private | project with a clear toggle.
- Supabase Realtime: members watch a live meeting's captions and the summary when ready; answer
  cards stay private to their owner.
- Project knowledge: upload files or links to Storage; chunk and embed for grounding. Vocabulary
  editor feeds STT key terms and Clarify.
- Action-item board: owner, status, due date; filters mine / all / overdue.
Acceptance: two test accounts on two machines see the same shared meeting live; RLS tests prove
non-members see nothing and private meetings never leak.
```

## Prompt 14: Privacy modes and consent tools

```
Read AGENTS.md and docs/PRD.md ("Privacy, consent and compliance").
- Announce button copies an editable consent message; Pause stops capture and logs a consent
  event; Resume asks for confirmation.
- Live-only mode: nothing written to disk or database; cleared when the meeting ends.
- Local-only mode: transcription with local faster-whisper, LLM tasks with Ollama if installed
  (else they are disabled), sync off, a "Local" badge in the overlay. A test fails if any
  network call leaves localhost in this mode.
- Settings shows each provider's trains_on_data flag; a toggle (off by default) is the only way
  to allow test-only providers for meeting data.
- Retention job, delete meeting, export account (zip of Markdown + JSON), delete account.
Acceptance: the localhost-only test passes; deleting a meeting removes audio, segments, chunks
and summaries.
```

## Prompt 15: Phone companion (Phase 4)

```
Read AGENTS.md and docs/PRD.md (FR-28). Create apps/mobile with Expo + TypeScript using the
shared event types:
- Sign in, pick project and meeting type, Start / Stop with a visible recording indicator.
- Phone mic as a single channel (16 kHz PCM16) streamed to the same WebSocket.
- Live captions, cards, Catch me up and Clarify; summaries and search read-only.
- Keep recording with the screen locked where the OS allows; persistent notification.
Acceptance: a phone next to a laptop on speaker produces a usable transcript and cards.
```

## Prompt 16: Integrations

```
Read AGENTS.md and docs/PRD.md (FR-29). Behind an Integrations interface, each with a Fake and
a Settings toggle:
- Calendar (Microsoft Graph, Google): upcoming meetings, auto-created meeting records with a
  guessed type, a nudge 1 minute before start.
- Jira: the user's tickets updated since the last standup feed standup prep.
- Post a summary to Teams or Slack by webhook only after the user previews and confirms.
```

## Prompt 17: Hardening and release

```
Read AGENTS.md and docs/PRD.md (Non-functional requirements, Success metrics).
- evals/ runner: word error rate, me-vs-others and named-speaker accuracy, action-item recall,
  p50/p95 latency per stage and per provider; CI fails on regressions (Fake mode).
- Nightly job: scripts/check-providers against every free provider; open a GitHub issue when a
  provider fails, changes limits or drops a model.
- electron-builder: unsigned NSIS for testers (signed once you buy a certificate); macOS signed
  and notarized once you join Apple's developer program; auto-update; Sentry; OpenTelemetry
  traces from desktop to backend.
- First-run setup flow from "Screens and UX", including the free-key wizard that tests each key.
- Performance check: under 15% CPU and 500 MB RAM during a 60-minute Fake-mode run.
Acceptance: a clean Windows machine installs, completes setup and records a meeting end to end.
```

## Fix-it prompt (any tool, any time something breaks)

```
Read AGENTS.md. Here is the error and what I did: <paste error, logs, steps>.
Find the root cause before changing code and explain it in two sentences. Fix it with the
smallest change, add a regression test, and run pnpm -w check. If this mistake has happened
before, add a one-line rule to AGENTS.md.
```
