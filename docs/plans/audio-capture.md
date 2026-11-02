# Audio capture (Prompt 3)

## Sources

| Channel | Windows | macOS 14.2+ | Linux |
|---|---|---|---|
| Mic | `getUserMedia` in a hidden capture window | same | same |
| System | `loopback-capture` native addon (WASAPI) | `getDisplayMedia` with `audio: 'loopback'` | `loopback-capture` (PipeWire), if installed |

### Why `loopback-capture` (evaluated, v4.0.0, MIT)

- Ships prebuilt N-API binaries for win32-x64 (and linux-x64), so there's no compiler step and
  no rebuild for Electron's Node ABI.
- System loopback **excluding our own process** (no feedback from the app's own sounds) and
  **per-process capture including child processes**, which is what "only capture Teams" needs
  (new Teams spawns WebView2 children). Per-process modes need Windows build 20348+.
- Output is 48 kHz stereo PCM16; we downmix and resample.
- It's an `optionalDependency` loaded lazily. If it's missing or fails to load, Windows falls
  back to Chromium's `getDisplayMedia` loopback (all system audio), and the status says which
  source is live.

Not chosen: writing our own WASAPI addon (same capabilities, more code to own), and
`getDisplayMedia` loopback on Windows as the main path (no per-app capture, and no way to
exclude our own output).

## Pipeline (per channel)

float audio → resample to 16 kHz (windowed-sinc low-pass + interpolation) → PCM16 →
20 ms frames (320 samples) → local WAV (everything) + level meter → mic only: Silero VAD gate
(300 ms padding before and after) → wire frame (byte 0 = channel) → outbound buffer.

- **Outbound buffer:** while no backend socket is attached, the last 60 s across both channels
  are kept and replayed in order on attach (Prompt 5 attaches the socket).
- **WAV:** `recordings/<timestamp>/{mic,system}.wav` under the app's user-data folder. The header
  is rewritten and the file fsynced every second; on startup, headers left stale by a crash are
  repaired from the file size.
- **VAD:** Silero v5 on onnxruntime-web (WebAssembly; no native build), about 1.5 ms per 32 ms
  window. Falls back to a loudness detector if the model can't load; the mic status shows
  which one is in use.
- **Silent system channel:** 15 s of digital silence marks the channel "silent" and the overlay
  links to a help page (missing macOS permission looks exactly like this).
- The capture window's AudioContext has no output device (`sinkId: {type: "none"}`) and runs
  at 16 kHz, so it works on machines without speakers and never plays anything.

## Not verified here (Linux CI only)

- A 2-minute Teams call on Windows producing both WAVs (needs a Windows machine).
- macOS loopback: the `enable-features` switches in `main/index.ts` and the permission flow.
