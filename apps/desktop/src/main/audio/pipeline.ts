// One channel's path: float audio at any rate -> 16 kHz PCM16 -> 20 ms frames ->
// local WAV (everything) + level meter + (mic only) VAD gate -> outbound wire frames.

import { AudioChannel, encodeFrame } from "@meeting-copilot/shared";
import { Framer } from "./framer";
import { LevelMeter } from "./levels";
import type { OutboundAudio } from "./outbound";
import { floatToPcm16, Resampler } from "./resample";
import { SilenceWatch } from "./silence";
import type { VadGate } from "./vad";
import { WavWriter } from "./wav";

export interface PipelineOptions {
  channel: AudioChannel;
  wavPath: string;
  outbound: OutboundAudio;
  /** Mic only: send frames only during speech. */
  vad?: VadGate;
  /** System only: called once when the stream has been digitally silent for a while. */
  onSilent?: () => void;
  silenceAfterMs?: number;
}

export class ChannelPipeline {
  private resampler: Resampler | null = null;
  private readonly framer = new Framer();
  private readonly meter = new LevelMeter();
  private readonly wav: WavWriter;
  private readonly silence: SilenceWatch | null;
  private pendingVad: Promise<unknown> = Promise.resolve();
  framesCaptured = 0;
  framesSent = 0;

  constructor(private readonly opts: PipelineOptions) {
    this.wav = new WavWriter(opts.wavPath);
    this.silence = opts.onSilent ? new SilenceWatch(opts.silenceAfterMs) : null;
  }

  get level(): number {
    return this.meter.read();
  }

  /** Mono float samples in [-1, 1] at `sampleRate`. */
  push(samples: Float32Array, sampleRate: number): void {
    if (!this.resampler || this.resampler.inputRate !== sampleRate) {
      this.resampler = new Resampler(sampleRate);
    }
    const pcm = floatToPcm16(this.resampler.process(samples));
    for (const frame of this.framer.push(pcm)) this.handle(frame);
  }

  private handle(frame: Int16Array): void {
    this.framesCaptured++;
    this.wav.write(frame);
    this.meter.push(frame);
    if (this.silence?.push(frame)) this.opts.onSilent?.();
    if (this.opts.vad) {
      const gated = this.opts.vad.push(frame).then((frames) => frames.forEach((f) => this.send(f)));
      this.pendingVad = this.pendingVad.then(() => gated).catch((err) => {
        console.error("[audio] VAD failed; sending frame ungated", err);
        this.send(frame);
      });
    } else {
      this.send(frame);
    }
  }

  private send(frame: Int16Array): void {
    this.framesSent++;
    this.opts.outbound.push(encodeFrame(this.opts.channel, frame));
  }

  async stop(): Promise<void> {
    for (const frame of this.framer.flush()) this.handle(frame);
    await this.pendingVad;
    this.wav.close();
  }
}
