import type { ApiPlugin } from '../core/types';

interface EventBusLike {
  emit: (event: string, payload: unknown) => unknown;
}

export function createEventsPlugin(eventBus: EventBusLike): ApiPlugin {
  const queue: Array<{ key: string; payload: unknown }> = [];
  let batchPromise: Promise<void> | null = null;

  function enqueue(key: string, payload: unknown): void {
    queue.push({ key, payload });
    if (!batchPromise) {
      batchPromise = Promise.resolve().then(() => {
        flush();
        batchPromise = null;
      });
    }
  }

  function flush(): void {
    const events = queue.splice(0);
    const merged = new Map<string, unknown[]>();
    for (const ev of events) {
      if (!merged.has(ev.key)) merged.set(ev.key, []);
      merged.get(ev.key)!.push(ev.payload);
    }
    for (const [key, payloads] of merged) {
      eventBus.emit(key, payloads.length === 1 ? payloads[0] : payloads);
    }
  }

  return {
    name: 'events',

    async onResponse(ctx) {
      if (ctx.config.onSuccess) {
        const keys = Array.isArray(ctx.config.onSuccess) ? ctx.config.onSuccess : [ctx.config.onSuccess];
        for (const key of keys) {
          if (key) enqueue(key, ctx.data);
        }
      }
      return ctx;
    },

    async onError(ctx) {
      const config = ctx.config;
      if (config.onError) {
        const code = (ctx.error as Error & { code?: number }).code;
        const eventKey = (code != null ? config.onError[code] : undefined) ?? config.onError.default;
        if (eventKey) enqueue(eventKey, ctx.error);
      }
      return ctx;
    },
  };
}
