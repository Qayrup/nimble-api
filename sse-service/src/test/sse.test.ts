import { describe, it, expect, vi, afterAll } from 'vitest';
import { createSSE, ReadyState } from '../index';

function sseStreamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('SSEConnection', () => {
  let stream: ReturnType<typeof createSSE>;

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('on() subscribes to named events', () => {
    stream = createSSE('/events', { reconnect: false });
    const handler = vi.fn();
    stream.on('user:login', handler);
    stream.close();
    // handler not called — fetch throws immediately
    expect(handler).not.toHaveBeenCalled();
  });

  it('onMessage() subscribes to all events', () => {
    stream = createSSE('/events', { reconnect: false });
    const handler = vi.fn();
    stream.onMessage(handler);
    stream.close();
  });

  it('onError() catches connection errors', async () => {
    const errorHandler = vi.fn();
    stream = createSSE('/events', { reconnect: false });
    stream.onError(errorHandler);
    // Wait for fetch to fail and error handler to fire
    await new Promise(r => setTimeout(r, 50));
    expect(errorHandler).toHaveBeenCalled();
    stream.close();
  });

  it('close() stops reconnection', () => {
    const closeHandler = vi.fn();
    stream = createSSE('/events', { reconnect: false });
    stream.onClose(closeHandler);
    stream.close();
    expect(closeHandler).toHaveBeenCalled();
  });

  it('baseUrl and params are included in URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test'));
    stream = createSSE('/events', {
      baseUrl: '/api',
      params: { userId: '123' },
      reconnect: false,
    });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/events?userId=123'),
      expect.any(Object),
    );
    fetchSpy.mockRestore();
    stream.close();
  });

  it('unsubscribe returned from on() works', () => {
    stream = createSSE('/events', { reconnect: false });
    const handler = vi.fn();
    const unsub = stream.on('event', handler);
    unsub();
    stream.close();
  });

  it('transitions to CLOSED and fires close callback after maxAttempts on rapid disconnects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(sseStreamResponse([])));
    const conn = createSSE('/events', { reconnect: { maxAttempts: 2, interval: 20 } });
    const onClose = vi.fn();
    const onError = vi.fn();
    conn.onClose(onClose);
    conn.onError(onError);

    await vi.waitFor(() => expect(conn.readyState).toBe(ReadyState.CLOSED), { timeout: 2000 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'SSE max reconnect attempts exceeded' }),
    );

    const calls = fetchSpy.mock.calls.length;
    expect(calls).toBe(3);
    await new Promise(r => setTimeout(r, 200));
    expect(fetchSpy.mock.calls.length).toBe(calls);
    fetchSpy.mockRestore();
  });

  it('reconnect backoff doubles interval up to maxInterval', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(sseStreamResponse([])));
      const conn = createSSE('/events', {
        reconnect: { maxAttempts: 5, interval: 1000, maxInterval: 5000 },
      });

      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1999);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(4000);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(5000);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      conn.close();
      fetchSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves trailing spaces in data lines', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(sseStreamResponse(['data: hello  \r\n\r\n'])));
    const conn = createSSE('/events', { reconnect: false });
    const onMessage = vi.fn();
    conn.onMessage(onMessage);

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalled(), { timeout: 1000 });
    expect(onMessage).toHaveBeenCalledWith('message', 'hello  ');
    conn.close();
    fetchSpy.mockRestore();
  });

  it('updates lastEventId from id-only block without dispatching', async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls++;
      return Promise.resolve(
        sseStreamResponse(calls === 1 ? ['id: evt-1\n\ndata: first\n\n'] : []),
      );
    });
    const conn = createSSE('/events', { reconnect: { interval: 20 } });
    const onMessage = vi.fn();
    conn.onMessage(onMessage);

    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(onMessage).toHaveBeenCalledTimes(1);
    const secondInit = fetchSpy.mock.calls[1][1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)['Last-Event-ID']).toBe('evt-1');
    conn.close();
    fetchSpy.mockRestore();
  });

  it('dispose() clears pending reconnect timer', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(sseStreamResponse([])));
      const conn = createSSE('/events', { reconnect: { interval: 1000 } });

      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      conn.dispose();
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(10000);
      await flushMicrotasks();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
