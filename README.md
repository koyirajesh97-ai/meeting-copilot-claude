# Meeting Copilot

A bot-free desktop copilot that listens to any meeting, knows your project and role, helps you
live, and leaves a shared project memory afterward. The full spec is in [docs/PRD.md](docs/PRD.md);
the step-by-step build prompts are in [docs/plans/build-prompts.md](docs/plans/build-prompts.md).
AI coding tools: read [AGENTS.md](AGENTS.md).

Status: Prompts 0–17 are done (repo, shared event schema, desktop shell and overlay, two-channel
audio capture to local WAV files, provider router, realtime gateway with live transcription,
database with row-level security, sign-in, live captions and the offline meeting cache, summaries
by meeting type, search and "Ask my meetings"). Phase 1 is complete; Phase 2 is done: voice
enrollment, speaker recognition, the role profile, answer cards, Catch me up, Clarify, I'll follow
up, topic cards, standup prep and the pre-meeting brief. Phase 3 is done: projects with
members and roles, invites, shared meetings members can watch live, project key terms and
documents, the action-item board, consent tools (Announce, Pause/Resume), Live-only and
Local-only modes, the test-provider opt-in, retention, delete and export.

### Evals

```bash
pnpm -w check:evals
```

Runs every eval in Fake mode and compares with `evals/baseline.json`; it fails on a regression (part
of `pnpm -w check`). It measures word error rate of the stored transcript through the real gateway
(with a provider failing mid-meeting and the client reconnecting), me-vs-others labeling, named
speakers (synthetic voices), action-item recall, live cards, and p50/p95 latency per stage and
provider. After an intended change, refresh the baseline with
`cd services/backend && uv run python ../../evals/run.py --update-baseline`.

The single evals can also run alone:

```bash
cd services/backend && uv run python ../../evals/summaries/run.py
```

Scores action-item recall on the fixtures in `evals/summaries/fixtures` (target 90%). CI runs it
with the Fake provider; add `--real` to use the free providers and `--long` to time a 60-minute
transcript.

```bash
cd services/backend && uv run python ../../evals/live/run.py
```

Live help: three questions to you get cited cards, a question to someone else gets none, and a
question with no answer in your notes gets "No grounded answer". Reports question-to-card latency
(target: median 2.5 s); `--real` uses the free providers for detection and cards.

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

This starts Supabase locally in Docker, applies the migrations in `supabase/migrations`, prints
its URL and keys, then runs the backend at http://127.0.0.1:8000. Copy from the printed status
into `.env`: `API URL` → `SUPABASE_URL`, `anon key` → `SUPABASE_ANON_KEY`, `DB URL` →
`DATABASE_URL`. Check it: http://127.0.0.1:8000/health returns `{"status": "ok", ...}`.

### Signing in

The apps sign in with an emailed one-time code (Settings → Account) through the hosted Supabase
project **meeting-copilot** (`https://qxzeghownilplbryvvzl.supabase.co`). Its URL and public
publishable key are built in (`packages/shared/src/hosted.ts`); its database already has every
migration in `supabase/migrations`. For the backend, set `SUPABASE_URL` to that address and
`DATABASE_URL` to the project's "Session pooler" connection string (dashboard → Connect).

To use a local stack instead, put its URL and anon key in Settings → Account → Supabase project.
With local Supabase, the email lands in its
test inbox at http://127.0.0.1:54324. The default Magic Link email template must show the code:
in Supabase Studio (http://127.0.0.1:54323) → Authentication → Email templates → Magic Link, add
`{{ .Token }}` (hosted Supabase: same place in the dashboard).

No Supabase yet? Start the backend with `ALLOW_DEV_LOGIN=1` and use "Use the local dev login".
Add `COPILOT_FAKE_PROVIDERS=1` to try the whole app with no AI keys (scripted captions).

### The desktop app

```bash
pnpm -C apps/desktop dev
```

Opens the main window and the overlay, and puts an icon in the tray. Hotkeys: Ctrl/Cmd+Shift plus
R (record), C (catch up), L (clarify), F (follow up), E (expand the overlay).

### First run

A new install opens a short setup: sign in, check audio (5 seconds, nothing saved), and your name
and role. If the backend is missing an AI key, a key step appears: each key is tested with one tiny
request and saved in the backend's `.env` when the backend runs on the same computer
(`scripts/dev-up` allows that). Settings → Advanced → "Run the setup again" reopens it.

### Installers and updates

```bash
pnpm -C apps/desktop dist:win      # NSIS installer for testers (unsigned)
```

```bash
pnpm -C apps/desktop dist:mac      # dmg + zip; signed and notarized when the Apple secrets are set
```

Pushing a tag like `v0.1.0` runs `.github/workflows/release.yml`: it builds Windows, macOS and
Linux packages, smoke-tests the packaged app, and publishes them as a GitHub Release, which the
app's auto-update (Settings → Advanced) reads. Windows builds stay unsigned (SmartScreen warns)
until you add `CSC_LINK` and `CSC_KEY_PASSWORD` secrets; macOS needs `CSC_LINK` plus
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

Diagnostics are opt-in (Settings → Advanced): crash reports go to Sentry when the
build has `MAIN_VITE_SENTRY_DSN` (and the backend `SENTRY_DSN`), and request traces go to an
OpenTelemetry collector (`MAIN_VITE_OTEL_ENDPOINT`, backend `OTEL_EXPORTER_OTLP_ENDPOINT`; install
the backend's extra with `uv sync --extra telemetry`). They never include what was said. Every
desktop request carries a `traceparent` header, and the backend logs its trace id, so the two
sides line up even without a collector.

Performance check (target: under 15% CPU and 500 MB RAM; CI runs 30 seconds):

```bash
COPILOT_PERF_MINUTES=60 pnpm -C apps/desktop test:perf
```

### The phone app

The phone companion (`apps/mobile`, Expo) records with the phone's microphone, so it works next
to a laptop you can't install anything on. It needs a development build (the audio module is
native, so Expo Go can't run it):

```bash
pnpm -C apps/mobile android
```

(`ios` on a Mac with Xcode.) On first launch open Settings and set the backend URL to an address
the phone can reach (your computer's LAN IP, e.g. `http://192.168.1.20:8000`, with the backend
started with `--host 0.0.0.0`) and the Supabase URL and anon key. Then sign in with the same
account as the desktop.

To build an installable Android app (APK) for testers instead (needs JDK 17 and the Android SDK
with `ANDROID_HOME` set):

```bash
pnpm -C apps/mobile build:apk
```

The APK lands in `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. It's signed
with the debug key, so it installs on test phones (allow "install unknown apps") but isn't for
the Play Store. Tagged releases also build it and attach it to the GitHub Release.

iOS apps can only be built on a Mac, so `.github/workflows/ios.yml` builds them on GitHub's
macOS runners (run it from the Actions tab, or push a `v*` tag). Each run produces:

- `MeetingCopilot-simulator.zip`: unzip and drag the app onto an iOS Simulator (Xcode).
- `MeetingCopilot-unsigned.ipa`: install on your own iPhone with a sideloading tool such as
  AltStore or Sideloadly, which signs it with your Apple ID (free accounts: 7 days per install).
- `MeetingCopilot-signed.ipa`, only once you add the Apple signing secrets
  (`IOS_CERTIFICATE_P12_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`,
  `APPLE_TEAM_ID`) from the Apple Developer Program: installs on the devices in that profile.
  TestFlight and the App Store need the same membership.

### The web app

`apps/web` is the desktop app's screens running in a browser (Chrome or Edge for meeting audio).
It records your microphone plus the meeting's audio from a shared tab ("Share tab audio") and
shows the overlay as a floating panel; **Pop out** keeps it on top of the meeting tab. Nothing
is saved in the browser: meetings live on your backend. With no backend built in, the site asks
for your server's address (and checks it answers) before anything else; there's no sample data.

```bash
pnpm -C apps/web dev          # http://localhost:5190
pnpm -C apps/web build        # static site in apps/web/dist
```

GitHub Pages: turn on Pages (Settings → Pages → Source: GitHub Actions), then run the
"Web app (GitHub Pages)" workflow; the site appears at `https://<owner>.github.io/<repo>/`. Set
the repository variables `BACKEND_URL`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` to make it the
server built in (otherwise visitors enter it themselves), and add the Pages origin (e.g. `https://koyirajesh97-ai.github.io`)
to the backend's `COPILOT_WEB_ORIGINS`.

Deploying to Vercel (static hosting; the backend runs elsewhere because it needs WebSockets):

1. Host the backend (Render, Fly.io, Railway or your own server) and set
   `COPILOT_WEB_ORIGINS=https://your-site.vercel.app` on it so the browser may call it.
2. In Vercel, import the repo with **Root Directory** `apps/web` (`apps/web/vercel.json` does the
   install and build) and set `VITE_BACKEND_URL`, `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the public anon key; never a provider API key).
3. Deploy. Without `VITE_BACKEND_URL` the site opens on "Connect to your Meeting Copilot
   server", where each visitor enters their own server.

### Hosting the backend (Render, free)

`render.yaml` deploys the backend as a Docker web service on Render's free plan (512 MB; it
sleeps after 15 minutes idle and takes about a minute to wake on the next request).

**Production mode.** With `COPILOT_ENV=production` (set by `render.yaml`) the backend refuses to
start until its settings are complete and safe, and lists what's missing: `BACKEND_SECRET`,
`VOICEPRINT_KEY`, `INTEGRATIONS_KEY`, `DATABASE_URL`, an https `SUPABASE_URL`, at least one AI key
for captions, summaries and live cards (a single free `GROQ_API_KEY` covers all three), and
neither `ALLOW_DEV_LOGIN` nor `COPILOT_FAKE_PROVIDERS`. `/health` says the process is up;
`/ready` also checks the database (Render waits for it before switching traffic).

**Built-in settings.** `config/client.json` holds what the apps are built with: the Supabase
project's URL and public publishable key, and `backendUrl`. Put your hosted server's address in
`backendUrl` and rebuild; the desktop, phone and web apps then use it without anyone typing it.

1. Open https://render.com/deploy?repo=https://github.com/koyirajesh97-ai/meeting-copilot-claude
   and sign in (GitHub works; no card for the free plan).
2. Render generates `BACKEND_SECRET`, `VOICEPRINT_KEY` and `INTEGRATIONS_KEY`, and asks for:
   `DATABASE_URL` (Supabase dashboard → Connect → "Session pooler"), the free AI keys
   `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPGRAM_API_KEY`, and `COPILOT_WEB_ORIGINS` (your web
   app's address, or leave it empty for now). `SUPABASE_SERVICE_ROLE_KEY` is optional (email
   invites and document uploads).
3. Click **Apply**. The server's address (`https://meeting-copilot-api-….onrender.com`) goes into
   the apps' Settings → server, and into Vercel as `VITE_BACKEND_URL`.

To run the same image elsewhere: `docker build -f services/backend/Dockerfile -t meeting-copilot-backend .`
then `docker run -p 8000:8000 --env-file .env meeting-copilot-backend`.

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

Runs ESLint, TypeScript builds and Vitest for the JS packages, the desktop Playwright tests
(under `xvfb-run` on Linux without a display; one of them starts the real backend in
fake-provider mode and records a meeting end to end), then ruff and pytest for the backend.
Database and row-level-security tests use `DATABASE_URL` if set, otherwise a throwaway local
Postgres if one is installed (with pgvector), and are skipped if neither is available. GitHub Actions runs the same command on every push.

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
