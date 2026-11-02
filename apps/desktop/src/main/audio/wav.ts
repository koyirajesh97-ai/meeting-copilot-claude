// Crash-safe WAV writer: the header's sizes are rewritten every second and the file is synced,
// so a crash loses at most about a second. `repairWav` fixes the header of a file left behind
// by a crash, based on its real length.

import { closeSync, fstatSync, fsyncSync, openSync, readSync, writeSync } from "node:fs";
import { SAMPLE_RATE } from "@meeting-copilot/shared";

const HEADER = 44;

function header(dataBytes: number, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(HEADER);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

export class WavWriter {
  private fd: number | null;
  private dataBytes = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private lastSync = Date.now();

  constructor(
    readonly path: string,
    private readonly syncEveryMs = 1000,
  ) {
    this.fd = openSync(path, "w");
    writeSync(this.fd, header(0), 0, HEADER, 0);
  }

  get bytesWritten(): number {
    return this.dataBytes + this.pendingBytes;
  }

  write(frame: Int16Array): void {
    if (this.fd === null) throw new Error("WAV writer is closed");
    const b = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    this.pending.push(Buffer.from(b)); // copy: frames may be reused by the caller
    this.pendingBytes += b.byteLength;
    if (Date.now() - this.lastSync >= this.syncEveryMs) this.flush();
  }

  flush(): void {
    if (this.fd === null) return;
    if (this.pendingBytes > 0) {
      const chunk = Buffer.concat(this.pending, this.pendingBytes);
      writeSync(this.fd, chunk, 0, chunk.byteLength, HEADER + this.dataBytes);
      this.dataBytes += chunk.byteLength;
      this.pending = [];
      this.pendingBytes = 0;
    }
    writeSync(this.fd, header(this.dataBytes), 0, HEADER, 0);
    fsyncSync(this.fd);
    this.lastSync = Date.now();
  }

  close(): void {
    if (this.fd === null) return;
    this.flush();
    closeSync(this.fd);
    this.fd = null;
  }
}

/** Rewrite the header of a WAV whose sizes don't match its length. Returns true if fixed. */
export function repairWav(path: string): boolean {
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size < HEADER) return false;
    const dataBytes = (size - HEADER) & ~1; // whole samples only
    const current = Buffer.alloc(HEADER);
    readSync(fd, current, 0, HEADER, 0);
    if (current.readUInt32LE(40) === dataBytes && current.readUInt32LE(4) === 36 + dataBytes) return false;
    writeSync(fd, header(dataBytes, current.readUInt32LE(24) || SAMPLE_RATE), 0, HEADER, 0);
    fsyncSync(fd);
    return true;
  } finally {
    closeSync(fd);
  }
}

