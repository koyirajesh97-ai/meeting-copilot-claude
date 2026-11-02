/**
 * Fixed-capacity FIFO that drops the oldest items when full. Holds wire frames captured
 * while the backend socket is down so they can be replayed after a reconnect.
 */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private count = 0;
  /** Items overwritten because the buffer was full. */
  dropped = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error("capacity must be a positive integer");
    this.items = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const tail = (this.head + this.count) % this.capacity;
    this.items[tail] = item;
    if (this.count < this.capacity) this.count++;
    else {
      this.head = (this.head + 1) % this.capacity;
      this.dropped++;
    }
  }

  /** Remove and return everything, oldest first. */
  drain(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      out.push(this.items[idx] as T);
      this.items[idx] = undefined;
    }
    this.head = 0;
    this.count = 0;
    return out;
  }
}
