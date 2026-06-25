export class Semaphore {
    cap;
    inUse = 0;
    queue = [];
    constructor(cap) {
        if (!Number.isFinite(cap) || cap < 1) {
            throw new Error(`Semaphore cap must be a positive integer, got ${cap}.`);
        }
        this.cap = cap;
    }
    get pending() {
        return this.queue.length;
    }
    get available() {
        return this.cap - this.inUse;
    }
    async acquire() {
        if (this.inUse < this.cap) {
            this.inUse += 1;
            return;
        }
        return new Promise((resolve) => {
            this.queue.push({ resolve });
        });
    }
    release() {
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
