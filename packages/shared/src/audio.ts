// Audio on the wire: 16 kHz mono PCM16 little-endian, 20 ms frames, byte 0 = channel.

/** Channel byte: 0 = mic, 1 = system. */
export const AudioChannel = { Mic: 0, System: 1 } as const;
export type AudioChannel = (typeof AudioChannel)[keyof typeof AudioChannel];

export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
/** Samples per 20 ms frame. */
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** PCM bytes per frame (without the channel byte). */
export const FRAME_BYTES = FRAME_SAMPLES * 2;
/** A full wire message: channel byte + one frame. */
export const WIRE_FRAME_BYTES = FRAME_BYTES + 1;

export function encodeFrame(channel: AudioChannel, pcm: Int16Array): Uint8Array {
  if (pcm.length !== FRAME_SAMPLES) {
    throw new Error(`A frame must have ${FRAME_SAMPLES} samples, got ${pcm.length}`);
  }
  const out = new Uint8Array(WIRE_FRAME_BYTES);
  out[0] = channel;
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(1 + i * 2, pcm[i], true);
  return out;
}

export function decodeFrame(bytes: Uint8Array): { channel: AudioChannel; pcm: Int16Array } {
  if (bytes.length !== WIRE_FRAME_BYTES) {
    throw new Error(`A wire frame must be ${WIRE_FRAME_BYTES} bytes, got ${bytes.length}`);
  }
  const channel = bytes[0];
  if (channel !== AudioChannel.Mic && channel !== AudioChannel.System) {
    throw new Error(`Unknown audio channel ${channel}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(1 + i * 2, true);
  return { channel, pcm };
}
