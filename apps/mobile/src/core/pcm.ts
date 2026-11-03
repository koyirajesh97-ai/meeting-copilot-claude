// Phone mic audio -> wire frames. The phone hears everyone in the room (often a laptop on
// speaker), so its single channel is sent as "system": the backend diarizes it into speakers
// and recognizes your voice from your enrollment, instead of assuming every word is yours.

import { AudioChannel, encodeFrame, FRAME_SAMPLES } from "@meeting-copilot/shared";

export const PHONE_CHANNEL = AudioChannel.System;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

/** Base64 (what the native recorder hands over) -> bytes. No atob: works on every JS engine. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** Little-endian PCM16 bytes -> samples (an odd trailing byte is carried to the next chunk). */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Collects 16 kHz PCM16 chunks of any size into 20 ms wire frames. */
export class PhoneFramer {
  private carry = new Int16Array(0);
  private oddByte: number | null = null;
  frames = 0;

  /** A recorder chunk: base64 PCM16 (native), Int16Array or Float32Array (web). */
  pushChunk(data: string | Int16Array | Float32Array): Uint8Array[] {
    if (typeof data === "string") {
      let bytes = base64ToBytes(data);
      if (this.oddByte !== null) {
        const b = new Uint8Array(bytes.length + 1);
        b[0] = this.oddByte;
        b.set(bytes, 1);
        bytes = b;
        this.oddByte = null;
      }
      if (bytes.length % 2) {
        this.oddByte = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      return this.push(bytesToInt16(bytes));
    }
    return this.push(data instanceof Float32Array ? floatToInt16(data) : data);
  }

  push(pcm: Int16Array): Uint8Array[] {
    const all = new Int16Array(this.carry.length + pcm.length);
    all.set(this.carry);
    all.set(pcm, this.carry.length);
    const out: Uint8Array[] = [];
    let i = 0;
    for (; i + FRAME_SAMPLES <= all.length; i += FRAME_SAMPLES) {
      out.push(encodeFrame(PHONE_CHANNEL, all.slice(i, i + FRAME_SAMPLES)));
    }
    this.carry = all.slice(i);
    this.frames += out.length;
    return out;
  }
}

/** Peak level of a chunk in [0, 1], for the on-screen meter. */
export function level(pcm: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak / 32768;
}
