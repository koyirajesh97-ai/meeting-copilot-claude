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
- Replace the code-drawn tray icons with real icon files before packaging (Prompt 17).
- Install the Supabase CLI locally (`scripts/dev-up` falls back to `npx supabase`).
