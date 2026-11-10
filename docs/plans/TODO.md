# TODO

Follow-ups that were out of scope for the prompt that found them.

- Add the WebSocket control messages (pause, resume, catch_up, clarify, follow_up,
  card_feedback, ping, last-seq resume) to the shared schema before Prompt 5.
- Bump GitHub Actions to versions that run on Node 24 (CI shows a Node 20 deprecation warning).
- Check by hand on Windows: the overlay stays above a full-screen Teams window and never takes
  keyboard focus (CI only checks the window flags on Linux).
- Check by hand on Windows: a 2-minute Teams call produces mic.wav and system.wav, with and
  without "capture only ms-teams.exe" (see docs/plans/audio-capture.md).
- Check by hand on macOS 14.2+: system-audio loopback and the permission help flow.
- Run scripts/check-providers with real keys: the PRD's example model names (e.g.
  gemini/gemini-flash) may not match the providers' current model IDs.
- Check Gladia's free-plan data terms; set trains_on_data in config/providers.yaml accordingly.
- Manual check with a real Deepgram key: captions appear in under 1 s (`stt.partial_ms` in
  GET /metrics), and stopping Deepgram mid-meeting falls back to Groq Whisper.
- After a network outage longer than 60 s, upload the missed audio from the local WAV so the
  transcript has no gap (today only the last 60 s are replayed).
- Sign-in by magic link (deep link into the app) in addition to the emailed code.
- With real keys: run `evals/summaries/run.py --real --long` and confirm a 60-minute meeting
  summarizes in under 60 s; tune the prompts if recall is below 90%.
- Add more summary fixtures from real (consented) meetings; the current three are short.
- Meetings are indexed for search when their summary is saved; a meeting whose summary failed
  isn't searchable until Regenerate succeeds. Index on meeting end as well.
- Install the `embeddings` extra by default once the desktop bundles the backend, or document it.
- Speaker recognition with real voices: install the `speakers` extra (pyannote + torch), check
  the 0.75 threshold on consented recordings, and wire the `diarize` library as the CPU
  alternative (its API wasn't verified here, so it isn't in the chain yet).
- Re-check unmatched speakers later in long meetings (today: up to max_audio_s, then give up).
- Stream answer cards token by token (router streaming support); today the first bullet is sent
  as soon as the model finishes and the rest follow as deltas.
- Detect questions on partial captions too, to start earlier (risk table); today detection runs on
  finals.
- Answer cards can't be exercised in the desktop e2e on Linux (no system audio there); backend
  tests and evals/live cover them. Check on Windows with a real call.
- Follow-up drafts run after the summary; if the summary fails, drafts wait for a regenerate.
- Replace the code-drawn tray icons with real icon files before packaging (Prompt 17).
- Install the Supabase CLI locally (`scripts/dev-up` falls back to `npx supabase`).
- Two-machine check by hand (Prompt 13 acceptance): two accounts on two computers watch the same
  shared meeting live. The backend test covers it with two users on one server.
- Invites need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend to send the magic-link
  email; without them the invite is stored and applied when that email first signs in.
- Edit an action item's owner and due date from the board (the API supports it; the board only
  toggles done today).
- Watch socket fan-out is per backend process; run one backend (or add a shared pub/sub) before
  scaling out.
- Link documents are fetched once; add "refresh" for wiki pages that change.
- Local-only with real models: install faster-whisper (`local` STT) and Ollama, pull
  `llama3.2:3b` (or set another model in config/providers.yaml), and check card latency on a
  laptop; small local models may miss the 2.5 s card budget.
- Local-only meetings started while signed out record to the laptop only; add a way to upload
  or transcribe those WAVs later.
- Consent events for "objection" have an API but no button yet (Pause covers the common case).
- The retention job runs in the backend process every hour; with several backends, run it once
  (a scheduled job) instead.
- Phone companion acceptance on real devices: a phone next to a laptop on speaker, on iOS and
  Android, screen locked for 10 minutes; check transcript quality and that cards arrive. CI
  covers the phone's core against the real backend in Fake mode and bundles the Android JS.
- Phone: App Store / Play Store builds (EAS), an app icon and splash, and a way to set the
  backend URL by QR code from the desktop.
- Integrations with real accounts: register the Google and Microsoft OAuth apps, connect each,
  and check event times across time zones and recurring events; post to a real Slack and Teams
  channel (Teams Workflows webhooks need the Adaptive Card payload we send; check old O365
  connectors if anyone still uses them).
- Calendar nudge: only while the desktop app is running; add a phone push for the companion.
- Jira Server / Data Center (PAT auth) isn't supported yet; only Jira Cloud.
- Prompt 17 acceptance on a clean Windows 10/11 machine: install the NSIS build, finish setup,
  record a Teams meeting end to end (captions, cards, summary), then update to a newer tag.
  CI covers the Linux package and the packaged-app smoke test; Windows and macOS packages are
  built and smoke-tested by the release workflow but haven't been run on real machines yet.
- Buy a Windows code-signing certificate and join the Apple Developer Program, then add the
  signing secrets (see README "Installers and updates").
- Run the 60-minute performance check on a real 16 GB laptop with real providers (CI measures
  30 s in Fake mode under xvfb: about 2% CPU and 460 MB proportional memory, close to the
  500 MB target, mostly the hidden capture window and software rendering; check on hardware).
- Word error rate with real providers needs your own consented recordings with reference
  transcripts; the CI eval measures our pipeline (no lost or duplicated captions), not the model.
- App icons for the installers (build/icon.ico, build/icon.icns) before the first public release.
- Web app: host the backend somewhere with WebSockets (Render, Fly.io, Railway), set
  `COPILOT_WEB_ORIGINS` and the Vercel `VITE_*` variables, then record a real Meet/Teams-in-browser
  meeting with tab audio. Safari and Firefox can't share tab audio (mic only); check both.
- Web app: calendar nudges and browser notifications (the desktop's 1-minute nudge isn't wired
  in the browser yet), and code-splitting the 650 kB bundle.
- Web app: the backend token sits in localStorage (short-lived, no provider keys); consider an
  httpOnly cookie session if the site is shared widely.
- Hosted Supabase project "meeting-copilot": in the dashboard, add `{{ .Token }}` to
  Authentication → Email templates → Magic Link (the apps sign in with the code), and set up
  custom SMTP before inviting people (the built-in sender is rate-limited). The `vector`
  extension sits in the public schema (security advisor warning); moving it means recreating
  the `chunks` embedding column, so it's left for a maintenance window.
- Production: rate-limit the sign-in routes (`/auth/session`, `/auth/dev-session`) and WebSocket
  connects per IP; Render's free plan has no built-in limiter.
- Production: structured JSON logs and log shipping (the backend logs plain text to stdout today).
- Embedding model download on Render: verify on the first deploy (the build fetches it from
  Hugging Face; this sandbox couldn't). Without it, search runs on keywords alone.
- Phone app: "Continue with Google" via a deep link (email/password, sign-up and reset are done).
- Desktop: "Continue with Google" through a loopback redirect (the web app has it already).
- Rate limits are per process (in memory); with more than one backend instance, move them to a
  shared store (Redis).
- Project links: the address is checked before each request, but a DNS answer could change between
  the check and the connection (rebinding); pin the checked IP in the connection to close that.
- Add a second free AI key (MISTRAL_API_KEY) on the hosted server so summaries and cards have a
  fallback when Groq's daily limits run out (1,000 requests a day per model).
