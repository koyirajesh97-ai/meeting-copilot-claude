// The browser's version of the desktop capture: your microphone, plus the meeting's audio from a
// shared tab or screen (Chrome and Edge; Safari and Firefox can't share audio, so they record the
// mic only). Audio becomes the same 16 kHz PCM16 wire frames as the desktop app, channel 0 = mic,
// 1 = meeting. Nothing is written to disk.

import { AudioChannel, encodeFrame, type OutboundAudio } from "@meeting-copilot/shared";
import { Framer } from "@desktop/main/audio/framer";
import { floatToPcm16, Resampler } from "@desktop/main/audio/resample";
import workletUrl from "@desktop/renderer/src/captureWorklet.ts?worker&url";
import type { AudioLevels, ChannelState, ChannelStatus } from "@desktop/shared/ipc";

type Channel = "mic" | "system";

interface Running {
  stream: MediaStream;
  ctx: AudioContext;
}

export interface RecorderEvents {
  status: (s: ChannelStatus) => void;
  levels: (l: AudioLevels) => void;
}

export class WebRecorder {
  private running = new Map<Channel, Running>();
  private status: ChannelStatus = { mic: { state: "off" }, system: { state: "off" } };
  private peaks: AudioLevels = { mic: 0, system: 0 };
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  /** Paused: incoming audio is dropped (not sent). */
  paused = false;
  /** Off for the audio check and local-only meetings: the meters move, nothing is queued. */
  sendEnabled = true;

  constructor(
    readonly outbound: OutboundAudio,
    private readonly on: RecorderEvents,
  ) {}

  get currentStatus(): ChannelStatus {
    return this.status;
  }

  private set(channel: Channel, s: ChannelState): void {
    this.status = { ...this.status, [channel]: s };
    this.on.status(this.status);
  }

  /** The share picker first (it needs the click that started the meeting), then the mic. */
  async start(opts: { micDeviceId: string | null; meetingAudio: boolean }): Promise<ChannelStatus> {
    await this.stop();
    this.paused = false;
    this.levelTimer = setInterval(() => {
      this.on.levels(this.peaks);
      this.peaks = { mic: 0, system: 0 };
    }, 100);
    this.set("mic", { state: "starting" });
    this.set("system", opts.meetingAudio ? { state: "starting" } : { state: "off" });
    if (opts.meetingAudio) {
      await this.open("system", async () => {
        if (!navigator.mediaDevices.getDisplayMedia) throw new DOMException("This browser can't share audio", "NotSupportedError");
        // Chrome needs video to show the picker; pick the meeting's tab and tick "Share tab audio".
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          // @ts-expect-error Chrome-only hints: offer system audio and keep playing it locally.
          systemAudio: "include",
          suppressLocalAudioPlayback: false,
          selfBrowserSurface: "exclude",
        });
        for (const t of stream.getVideoTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        return stream;
      });
    }
    await this.open("mic", () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.micDeviceId ? { exact: opts.micDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    );
    return this.status;
  }

  private async open(channel: Channel, get: () => Promise<MediaStream>): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await get();
    } catch (err) {
      const e = err as DOMException;
      const message =
        channel === "system"
          ? e.name === "NotAllowedError"
            ? "Meeting audio wasn't shared. Captions come from your microphone only."
            : `Meeting audio isn't available here (${e.message || e.name}).`
          : `Microphone: ${e.message || e.name}`;
      this.set(channel, { state: e.name === "NotAllowedError" ? "unavailable" : "error", message });
      return;
    }
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      this.set(channel, { state: "unavailable", message: 'No audio in that share: pick a tab and tick "Share tab audio".' });
      return;
    }
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "pcm-tap");
    const resampler = new Resampler(ctx.sampleRate);
    const framer = new Framer();
    const wire = channel === "mic" ? AudioChannel.Mic : AudioChannel.System;
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.paused) return;
      let peak = 0;
      for (const v of e.data) peak = Math.max(peak, Math.abs(v));
      this.peaks[channel] = Math.max(this.peaks[channel], peak);
      if (!this.sendEnabled) return;
      for (const frame of framer.push(floatToPcm16(resampler.process(e.data)))) this.outbound.push(encodeFrame(wire, frame));
    };
    // The tap outputs silence; a muted gain to the destination keeps the graph running.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination);
    await ctx.resume();
    for (const t of stream.getAudioTracks()) {
      t.addEventListener("ended", () => this.set(channel, { state: "error", message: channel === "system" ? "Sharing stopped." : "Microphone disconnected." }));
    }
    this.running.set(channel, { stream, ctx });
    this.set(channel, { state: "live", source: channel === "mic" ? "browser mic" : "shared tab or screen" });
  }

  async stop(): Promise<void> {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    for (const [channel, r] of this.running) {
      r.stream.getTracks().forEach((t) => t.stop());
      await r.ctx.close().catch(() => undefined);
      this.set(channel, { state: "off" });
    }
    this.running.clear();
    this.status = { mic: { state: "off" }, system: { state: "off" } };
    this.on.status(this.status);
    this.on.levels({ mic: 0, system: 0 });
  }
}

/** 16 kHz mono PCM16 WAV from float samples (voice enrollment). */
export function wavFromFloat(samples: Float32Array, rate: number): Blob {
  const pcm = floatToPcm16(new Resampler(rate).process(samples));
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

/** Record the mic for `seconds` (voice enrollment). Reports progress about 10 times a second. */
export async function recordMicSamples(
  micDeviceId: string | null,
  seconds: number,
  onProgress: (elapsed: number, level: number) => void,
): Promise<{ samples: Float32Array; rate: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: micDeviceId ? { exact: micDeviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(workletUrl);
    const tap = new AudioWorkletNode(ctx, "pcm-tap");
    const chunks: Float32Array[] = [];
    const want = Math.round(ctx.sampleRate * seconds);
    let have = 0;
    let peak = 0;
    let lastReport = 0;
    const done = new Promise<void>((resolve) => {
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (have >= want) return;
        chunks.push(e.data);
        have += e.data.length;
        for (const v of e.data) peak = Math.max(peak, Math.abs(v));
        const elapsed = have / ctx.sampleRate;
        if (elapsed - lastReport >= 0.1) {
          onProgress(Math.min(seconds, elapsed), peak);
          lastReport = elapsed;
          peak = 0;
        }
        if (have >= want) resolve();
      };
    });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);
    await ctx.resume();
    await done;
    const samples = new Float32Array(have);
    let o = 0;
    for (const c of chunks) {
      samples.set(c, o);
      o += c.length;
    }
    return { samples: samples.subarray(0, want), rate: ctx.sampleRate };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
  }
}
