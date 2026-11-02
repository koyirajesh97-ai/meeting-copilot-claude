# AGENTS.md — Meeting Copilot

## Product
Read docs/PRD.md before every task. Build only what the prompt asks.
Phases: 1 capture + transcript + summary + history, 2 live help, 3 projects + sync,
4 mobile + integrations.

## Layout
- apps/desktop: Electron + React + TypeScript + Vite + Tailwind. The main process owns audio
  capture and the backend WebSocket; the renderer is UI only (contextIsolation on).
- services/backend: Python 3.12, FastAPI, LiteLLM, pydantic v2, managed with uv.
- packages/shared/schema/events.json is the only source of event types; TS and Python
  types are generated from it.
- supabase/migrations: SQL only. Every table with project data has row-level security.

## Commands
- Desktop: pnpm -C apps/desktop dev | test | lint
- Backend: cd services/backend && uv run fastapi dev | uv run pytest | uv run ruff check
- Everything: pnpm -w check

## AI rules
- Every LLM call goes through app/router `complete(task, messages, data_class, json_schema)`.
  Never call a provider SDK directly from feature code.
- Providers, models, limits and fallback order live in config/providers.yaml, never in code.
- data_class is "meeting" for real meeting content and "test" for fixtures. Meeting data never
  goes to a provider with trains_on_data true or unknown.
- Prompts live in services/backend/app/prompts/*.md with {placeholders}; outputs are validated
  with pydantic and retried once.
- Every provider and adapter has a Fake for tests. CI never calls real APIs except the
  nightly smoke test.

## Other rules
- No API keys in the desktop app; it gets a short-lived token from the backend.
- Audio on the wire: 16 kHz mono PCM16, 20 ms frames, byte 0 = channel (0 mic, 1 system).
- Log latency per stage and the provider used for every AI call.
- The recording indicator is visible whenever audio is captured. No hidden features.
- Write or update tests for every change; done only when pnpm -w check passes.
- Stay in scope; put follow-ups in docs/plans/TODO.md.

## Done means
Code + tests + docs/PRD.md updated if behavior changed + a short note: what changed, how to run it.
