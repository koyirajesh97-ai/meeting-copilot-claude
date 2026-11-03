/** A tiny typed event emitter (works in Node, Electron and React Native). */
export class Emitter<E extends Record<string, unknown[]>> {
  private listeners: { [K in keyof E]?: ((...args: E[K]) => void)[] } = {};

  on<K extends keyof E>(event: K, fn: (...args: E[K]) => void): this {
    (this.listeners[event] ??= []).push(fn);
    return this;
  }

  off<K extends keyof E>(event: K, fn: (...args: E[K]) => void): this {
    this.listeners[event] = this.listeners[event]?.filter((f) => f !== fn);
    return this;
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): boolean {
    const fns = this.listeners[event];
    fns?.slice().forEach((f) => f(...args));
    return !!fns?.length;
  }
}
