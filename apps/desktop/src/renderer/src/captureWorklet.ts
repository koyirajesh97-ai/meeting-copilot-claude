// AudioWorklet that taps the input, mixes it to mono and posts 20 ms chunks to the page.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

const CHUNK = Math.round(sampleRate * 0.02);

class PcmTap extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private fill = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c][i];
      this.buf[this.fill++] = s / input.length;
      if (this.fill === CHUNK) {
        // Transferring detaches this.buf (its length becomes 0), so size the next one from CHUNK.
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(CHUNK);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);
