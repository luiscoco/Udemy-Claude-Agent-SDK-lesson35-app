export class Inbox<T> {
  private items: T[] = [];
  private wake: ((value: T | null) => void) | null = null;
  closed = false;
  maxDepth = 0;
  constructor(private limit = 8) {}
  get size() {
    return this.items.length;
  }
  push(value: T) {
    if (this.closed) throw new Error("This input queue is closed.");
    if (this.wake) {
      const resolve = this.wake;
      this.wake = null;
      resolve(value);
      return;
    }
    if (this.items.length >= this.limit)
      throw new Error("The classroom queue is full.");
    this.items.push(value);
    this.maxDepth = Math.max(this.maxDepth, this.items.length);
  }
  take(): Promise<T | null> {
    if (this.items.length) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    if (this.wake) throw new Error("Only one queue consumer is allowed.");
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }
  close() {
    this.closed = true;
    this.items = [];
    this.wake?.(null);
    this.wake = null;
  }
}
