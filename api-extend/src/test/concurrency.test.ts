import { describe, it, expect, vi } from 'vitest';
import { createConcurrencyLimit } from '../index';

describe('createConcurrencyLimit', () => {
  it('throws for limit < 1', () => {
    expect(() => createConcurrencyLimit(0)).toThrow('Concurrency limit must be >= 1');
    expect(() => createConcurrencyLimit(-1)).toThrow('Concurrency limit must be >= 1');
  });

  it('runs tasks up to the limit concurrently', async () => {
    const limiter = createConcurrencyLimit(2);
    const order: number[] = [];

    const makeTask = (id: number, delay: number) => vi.fn(async () => {
      order.push(id);
      await new Promise(r => setTimeout(r, delay));
      return id;
    });

    const t1 = makeTask(1, 60);
    const t2 = makeTask(2, 60);
    const t3 = makeTask(3, 10);

    // Start all three
    const p1 = limiter(() => t1());
    const p2 = limiter(() => t2());
    const p3 = limiter(() => t3());

    // First two should start immediately
    await new Promise(r => setTimeout(r, 10));
    expect(t1).toHaveBeenCalledTimes(1);
    expect(t2).toHaveBeenCalledTimes(1);
    expect(t3).not.toHaveBeenCalled();
    expect(limiter.running).toBe(2);
    expect(limiter.pending).toBe(1);

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
    expect(t3).toHaveBeenCalledTimes(1);
  });

  it('processes queue in FIFO order', async () => {
    const limiter = createConcurrencyLimit(1);
    const order: number[] = [];

    const p1 = limiter(async () => {
      order.push(1);
      await new Promise(r => setTimeout(r, 30));
    });
    const p2 = limiter(async () => {
      order.push(2);
    });
    const p3 = limiter(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('rejected tasks do not block the queue', async () => {
    const limiter = createConcurrencyLimit(1);
    const order: number[] = [];

    const p1 = limiter(async () => {
      order.push(1);
      throw new Error('fail');
    });
    const p2 = limiter(async () => {
      order.push(2);
      return 'ok';
    });

    await expect(p1).rejects.toThrow('fail');
    const r2 = await p2;
    expect(r2).toBe('ok');
    expect(order).toEqual([1, 2]);
  });

  it('running and pending reflect current state', async () => {
    const limiter = createConcurrencyLimit(1);
    expect(limiter.running).toBe(0);
    expect(limiter.pending).toBe(0);

    let resolveFirst!: () => void;
    const p1 = limiter(() => new Promise<void>(r => { resolveFirst = r; }));
    await new Promise(r => setTimeout(r, 5));

    expect(limiter.running).toBe(1);
    expect(limiter.pending).toBe(0);

    const p2 = limiter(() => Promise.resolve());
    expect(limiter.pending).toBe(1);

    resolveFirst();
    await p1;
    await p2;
    await Promise.resolve(); // flush microtask so .finally(running--) has run

    expect(limiter.running).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('clear() removes all queued tasks and rejects their promises', async () => {
    const limiter = createConcurrencyLimit(1);
    const executed: number[] = [];

    let unblock!: () => void;
    const p1 = limiter(() => new Promise<void>(r => { unblock = r; }).then(() => { executed.push(1); }));

    await new Promise(r => setTimeout(r, 5));

    const p2 = limiter(() => { executed.push(2); return Promise.resolve(); });
    const p3 = limiter(() => { executed.push(3); return Promise.resolve(); });

    expect(limiter.pending).toBe(2);

    limiter.clear();
    expect(limiter.pending).toBe(0);

    unblock();
    await p1;
    await expect(p2).rejects.toThrow('Queue cleared');
    await expect(p3).rejects.toThrow('Queue cleared');
    expect(executed).toEqual([1]);
  });

  it('respects limit of 1 (serial execution)', async () => {
    const limiter = createConcurrencyLimit(1);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limiter(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(1);
  });
});
