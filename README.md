# Meeting Copilot

A bot-free desktop copilot that listens to any meeting, knows your project and role, helps you
live, and leaves a shared project memory afterward. The full spec is in [docs/PRD.md](docs/PRD.md);
the step-by-step build prompts are in [docs/plans/build-prompts.md](docs/plans/build-prompts.md).
AI coding tools: read [AGENTS.md](AGENTS.md).

Status: Prompts 0–4 are done (repo, shared event schema, desktop shell and overlay, two-channel
audio capture to local WAV files, provider router). Nothing is sent to the backend yet.

## 1. Create the free accounts and keys

None of these needs a credit card.

| Service | Used for | Key |
|---|---|---|
| [Deepgram](https://console.deepgram.com/signup) | Live captions ($200 signup credit) | `DEEPGRAM_API_KEY` |
| [Groq](https://console.groq.com/keys) | Question detection, answer cards | `GROQ_API_KEY` |
| [Mistral](https://console.mistral.ai/api-keys) | Summaries, "Ask my meetings" | `MISTRAL_API_KEY` |
| [Hugging Face](https://huggingface.co/settings/tokens) | Downloading pyannote; accept the terms on the `pyannote/speaker-diarization-community-1` model page first | `HF_TOKEN` |

Optional fallbacks: [Gemini](https://aistudio.google.com/apikey) (test data only, its free tier
may train on prompts), [OpenRouter](https://openrouter.ai/keys), [Gladia](https://app.gladia.io),
[Cloudflare Workers AI](https://dash.cloudflare.com) (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`).

## 2. Install the tools

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Supabase)
- Node 22+ with pnpm: `corepack enable`
- Python tooling: [uv](https://docs.astral.sh/uv/getting-started/installation/) (it installs Python 3.12 for you)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (optional: `scripts/dev-up` falls back to `npx supabase`)

## 3. Set up the repo

```bash
pnpm install
```

```bash
cd services/backend && uv sync && cd ../..
```

```bash
cp .env.example .env
```

Fill in the keys in `.env`. Never commit it (it's in `.gitignore`).

## 4. Run it

```bash
scripts/dev-up
```

This starts Supabase locally in Docker, prints its URL and keys (copy `anon key` and
`service_role key` into `.env`), then runs the backend at http://127.0.0.1:8000.
Check it: http://127.0.0.1:8000/health returns `{"status": "ok"}`.

### The desktop app

```bash
pnpm -C apps/desktop dev
```

Opens the main window and the overlay, and puts an icon in the tray. Hotkeys: Ctrl/Cmd+Shift plus
R (record), C (catch up), L (clarify), F (follow up), E (expand the overlay).

### Check your AI keys

```bash
scripts/check-providers
```

Sends one tiny request to every provider in `config/providers.yaml` and prints status, latency
and remaining quota where the provider reports it. A GitHub Actions job runs it nightly; add your
keys as repository secrets (Settings → Secrets and variables → Actions) with the same names as
in `.env`.

## 5. Check everything

```bash
pnpm -w check
```

Runs ESLint, TypeScript builds and Vitest for the JS packages, the desktop Playwright smoke test
(under `xvfb-run` on Linux without a display), then ruff and pytest for the backend. GitHub Actions runs the same command on every push.

## Layout

```
apps/desktop        Electron app (Prompt 2)
apps/mobile         Expo phone companion (Prompt 15)
packages/shared     Event schema (schema/events.json) and generated types; `pnpm -w gen:events`
services/backend    FastAPI + LiteLLM backend
config/providers.yaml   Free AI providers, limits, fallback order, data policy
supabase/migrations SQL + row-level security (Prompt 6)
evals               Fixtures and accuracy/latency scripts
scripts             dev-up and provider checks
```
