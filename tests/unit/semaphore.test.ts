import { describe, expect, it, vi } from 'vitest';
import { Semaphore } from '../../src/dispatch/semaphore.js';

describe('Semaphore (FIFO)', () => {
  it('admits up to the cap in parallel and queues the rest', async () => {
    const sem = new Semaphore(2);
    const order: string[] = [];
    const make = (label: string) => async () => {
      await sem.acquire();
      order.push(`${label}:enter`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${label}:exit`);
      sem.release();
    };

    const a = make('A')();
    const b = make('B')();
    const c = make('C')();
    const d = make('D')();

    await Promise.all([a, b, c, d]);

    expect(order.slice(0, 2).sort()).toEqual(['A:enter', 'B:enter']);
    expect(order.slice(2).sort()).toEqual(['A:exit', 'B:exit', 'C:enter', 'C:exit', 'D:enter', 'D:exit']);
  });

  it('preserves FIFO ordering when releases are interleaved', async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const tasks = ['A', 'B', 'C'].map(
      (label) => async () => {
        await sem.acquire();
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`${label}:end`);
        sem.release();
      },
    );

    await Promise.all(tasks.map((t) => t()));

    expect(order).toEqual([
      'A:start',
      'A:end',
      'B:start',
      'B:end',
      'C:start',
      'C:end',
    ]);
  });

  it('runs all queued tasks eventually even with bursts', async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      await sem.acquire();
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 2));
      concurrent -= 1;
      sem.release();
    });
    await Promise.all(tasks.map((t) => t()));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('does not deadlock when release is called without a prior acquire (defensive)', () => {
    const sem = new Semaphore(1);
    const release = vi.fn();
    expect(() => sem.release()).not.toThrow();
    expect(sem.pending).toBe(0);
  });
});
