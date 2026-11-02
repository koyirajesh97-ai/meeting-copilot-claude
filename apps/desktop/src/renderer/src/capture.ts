// Hidden capture window: getUserMedia for the mic, getDisplayMedia loopback for system audio
// (macOS, or Windows without the native addon). Audio goes to main through the bridge.
import type { CaptureCommand, ChannelName } from "../../shared/ipc";
import workletUrl from "./captureWorklet.ts?worker&url";

interface Running {
  stream: MediaStream;
  ctx: AudioContext;
}

const running = new Map<ChannelName, Running>();
const api = window.copilot.capture;

async function openStream(cmd: Extract<CaptureCommand, { action: "start" }>): Promise<MediaStream> {
  if (cmd.channel === "mic") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: cmd.deviceId ? { exact: cmd.deviceId } : undefined,
        channelCount: 1,
        // Cancels the meeting audio leaking from laptop speakers into the mic.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  for (const t of stream.getVideoTracks()) {
    t.stop();
    stream.removeTrack(t);
  }
  return stream;
}

async function start(cmd: Extract<CaptureCommand, { action: "start" }>): Promise<void> {
  stop(cmd.channel);
  let stream: MediaStream;
  try {
    stream = await openStream(cmd);
  } catch (err) {
    const e = err as DOMException;
    const denied = e.name === "NotAllowedError" || e.name === "SecurityError";
    api.report({ channel: cmd.channel, state: denied ? "unavailable" : "error", message: `${e.name}: ${e.message}` });
    return;
  }
  if (stream.getAudioTracks().length === 0) {
    api.report({ channel: cmd.channel, state: "unavailable", message: "No audio track (system-audio permission may be missing)" });
    return;
  }
  const ctx = createContext();
  await ctx.audioWorklet.addModule(workletUrl);
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => api.chunk(cmd.channel, e.data, ctx.sampleRate);
  // The tap outputs silence; connecting it to the (silent) destination keeps the graph running.
  source.connect(tap).connect(ctx.destination);
  await ctx.resume();
  for (const t of stream.getAudioTracks()) {
    t.addEventListener("ended", () => api.report({ channel: cmd.channel, state: "error", message: "Audio device disconnected" }));
  }
  running.set(cmd.channel, { stream, ctx });
  api.report({ channel: cmd.channel, state: "live" });
}

/**
 * A capture-only context: no output device (so it runs on machines with no speakers, and
 * never plays anything), at 16 kHz so less audio crosses IPC.
 */
function createContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: 16_000, sinkId: { type: "none" } } as AudioContextOptions);
  } catch {
    return new AudioContext({ sampleRate: 16_000 });
  }
}

function stop(channel: ChannelName): void {
  const r = running.get(channel);
  if (!r) return;
  running.delete(channel);
  r.stream.getTracks().forEach((t) => t.stop());
  void r.ctx.close();
}

api.onCommand((cmd) => {
  if (cmd.action === "start") void start(cmd);
  else stop(cmd.channel);
});
