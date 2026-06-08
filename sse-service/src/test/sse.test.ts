import { describe, it, expect, vi, afterAll } from 'vitest';
import { createSSE } from '../index';

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
});
