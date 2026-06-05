import { describe, it, expect, vi } from 'vitest';
import { poll, PollTimeoutError, PollCanceledError, PollFailedError } from '../index';

interface TestData {
  status: string;
}

describe('poll', () => {
  it('resolves when until condition is met', async () => {
    let callCount = 0;
    const fn = vi.fn<() => Promise<TestData>>().mockImplementation(async () => {
      callCount++;
      return { status: callCount >= 3 ? 'done' : 'pending' };
    });

    const result = await poll(fn, {
      interval: 10,
      until: (data) => data.status === 'done',
    });

    expect(result.status).toBe('done');
    expect(callCount).toBe(3);
  });

  it('rejects with PollTimeoutError when maxAttempts exceeded', async () => {
    const fn = vi.fn<() => Promise<TestData>>().mockResolvedValue({ status: 'pending' });

    await expect(
      poll(fn, { interval: 5, until: () => false, maxAttempts: 3 }),
    ).rejects.toThrow(PollTimeoutError);
  });

  it('rejects with PollCanceledError on signal abort', async () => {
    const controller = new AbortController();
    const fn = vi.fn<() => Promise<TestData>>().mockResolvedValue({ status: 'pending' });

    const promise = poll(fn, {
      interval: 100,
      until: () => false,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow(PollCanceledError);
  });

  it('rejects with PollFailedError when stopIf fires', async () => {
    const fn = vi.fn<() => Promise<TestData>>().mockResolvedValue({ status: 'failed' });

    await expect(
      poll(fn, {
        interval: 5,
        until: () => false,
        stopIf: (data) => data.status === 'failed',
      }),
    ).rejects.toThrow(PollFailedError);
  });

  it('type narrows through until predicate', async () => {
    type Payment = { status: 'pending' | 'paid'; amount: number };

    const fn = vi.fn<() => Promise<Payment>>().mockResolvedValue({
      status: 'paid' as const,
      amount: 100,
    });

    const result = await poll(fn, {
      interval: 5,
      until: (data): data is Payment & { status: 'paid' } => data.status === 'paid',
    });

    if (result.status !== 'paid') throw new Error('unreachable');
    expect(result.amount).toBe(100);
  });
});
