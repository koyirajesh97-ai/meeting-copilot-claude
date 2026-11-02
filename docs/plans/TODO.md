# TODO

Follow-ups that were out of scope for the prompt that found them.

- Add the WebSocket control messages (pause, resume, catch_up, clarify, follow_up,
  card_feedback, ping, last-seq resume) to the shared schema before Prompt 5.
- Bump GitHub Actions to versions that run on Node 24 (CI shows a Node 20 deprecation warning).
- Check by hand on Windows: the overlay stays above a full-screen Teams window and never takes
  keyboard focus (CI only checks the window flags on Linux).
- Replace the code-drawn tray icons with real icon files before packaging (Prompt 17).
- Install the Supabase CLI locally (`scripts/dev-up` falls back to `npx supabase`).
