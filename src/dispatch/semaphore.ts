type Waiter = { resolve: () => void };

export class Semaphore {
  private readonly cap: number;
  private inUse = 0;
  private readonly queue: Waiter[] = [];

  constructor(cap: number) {
    if (!Number.isFinite(cap) || cap < 1) {
      throw new Error(`Semaphore cap must be a positive integer, got ${cap}.`);
    }
    this.cap = cap;
  }

  get pending(): number {
    return this.queue.length;
  }

  get available(): number {
    return this.cap - this.inUse;
  }

  async acquire(): Promise<void> {
    if (this.inUse < this.cap) {
      this.inUse += 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
    });
  }

  release(): void {
    if (this.inUse <= 0) {
      // Defensive: an extra release() should never crash the process.
      return;
    }
    this.inUse -= 1;
    const next = this.queue.shift();
    if (next) {
      this.inUse += 1;
      next.resolve();
    }
  }
}
