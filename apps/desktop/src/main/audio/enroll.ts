// Record the user's voice for enrollment: mic only, 16 kHz mono, a fixed length. The audio is
// uploaded once to make the encrypted voiceprint and not kept anywhere.

import { LevelMeter } from "./levels";
import { floatToPcm16, Resampler } from "./resample";
import type { AudioSource } from "./sources";

export async function recordMic(
  source: AudioSource,
  seconds: number,
  onProgress: (elapsedS: number, level: number) => void,
): Promise<Int16Array> {
  const target = Math.round(seconds * 16_000);
  const chunks: Int16Array[] = [];
  let have = 0;
  let resampler: Resampler | null = null;
  const meter = new LevelMeter();
  let lastReport = 0;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((r) => (done = r));
  await source.start((samples, rate) => {
    if (have >= target) return;
    if (!resampler || resampler.inputRate !== rate) resampler = new Resampler(rate);
    const pcm = floatToPcm16(resampler.process(samples));
    chunks.push(pcm);
    have += pcm.length;
    for (let i = 0; i + 320 <= pcm.length; i += 320) meter.push(pcm.subarray(i, i + 320));
    const elapsed = have / 16_000;
    if (elapsed - lastReport >= 0.1 || have >= target) {
      lastReport = elapsed;
      onProgress(Math.min(seconds, elapsed), meter.read());
    }
    if (have >= target) done();
  });
  try {
    await Promise.race([finished, new Promise((_, rej) => setTimeout(() => rej(new Error("Recording timed out")), (seconds + 15) * 1000))]);
  } finally {
    await source.stop();
  }
  const out = new Int16Array(target);
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, target - off);
    out.set(c.subarray(0, n), off);
    off += n;
    if (off >= target) break;
  }
  return out;
}
