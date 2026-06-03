import { snapshotSet } from './features/snapshot';
import type { EventMap, SubscribeOptions, Unsubscribe, MetaEventPayloads } from './core/types';

type AnyHandler = (...args: unknown[]) => void;

interface HandlerRecord {
  raw: AnyHandler;
}

export class EventHub<T extends EventMap = Record<string, unknown>> {
  #handlers = new Map<string, Set<HandlerRecord>>();
  #anyHandlers = new Set<HandlerRecord>();
  #destroyed = false;
  #emittingMeta = false;

  // === 订阅 ===

  on<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const record: HandlerRecord = { raw: handler as AnyHandler };

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event)!.add(record);

    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event });
    }

    const unsub = (): void => {
      const set = this.#handlers.get(event);
      if (set) {
        set.delete(record);
        if (set.size === 0) this.#handlers.delete(event);
      }
      if (!this.#emittingMeta) {
        this.#emitMeta('listenerRemoved', { event });
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  onAny(
    handler: (event: keyof T & string, payload: T[keyof T]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const record: HandlerRecord = { raw: handler as AnyHandler };
    this.#anyHandlers.add(record);

    const unsub = (): void => {
      this.#anyHandlers.delete(record);
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  // === 一次性 ===

  once<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T[K]> {
    this.#checkDestroyed();

    return new Promise<T[K]>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsub = this.on(
        event,
        (payload) => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          unsub();
          resolve(payload);
        },
        { signal: opts?.signal },
      );

      if (opts?.timeout != null) {
        timeoutId = setTimeout(() => {
          unsub();
          const err = new Error('[@nimble-api/eventhub] once() timed out');
          err.name = 'TimeoutError';
          reject(err);
        }, opts.timeout);
      }

      if (opts?.signal) {
        opts.signal.addEventListener(
          'abort',
          () => {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            unsub();
            const err = new Error('[@nimble-api/eventhub] once() aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      }
    });
  }

  // === 取消订阅 ===

  off<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
  ): void {
    if (this.#destroyed) return;
    const set = this.#handlers.get(event);
    if (!set) return;

    for (const record of set) {
      if (record.raw === (handler as AnyHandler)) {
        set.delete(record);
        if (set.size === 0) this.#handlers.delete(event);
        if (!this.#emittingMeta) {
          this.#emitMeta('listenerRemoved', { event });
        }
        return;
      }
    }
  }

  offAll(event?: keyof T & string): void {
    if (this.#destroyed) return;
    if (event) {
      const existed = this.#handlers.delete(event);
      if (existed) {
        this.#emitMeta('listenerRemoved', { event });
      }
    } else {
      const names = [...this.#handlers.keys()].filter(
        n => n !== 'listenerAdded' && n !== 'listenerRemoved',
      );
      // Emit meta BEFORE clearing so the meta listeners themselves still exist
      for (const name of names) {
        this.#emitMeta('listenerRemoved', { event: name });
      }
      this.#handlers.clear();
      this.#anyHandlers.clear();
    }
  }

  // === 发射 ===

  emit<K extends keyof T & string>(event: K, payload: T[K]): void {
    this.#checkDestroyed();

    const specificHandlers = this.#handlers.get(event);
    const specificSnapshot = specificHandlers ? snapshotSet(specificHandlers) : [];
    const anySnapshot = snapshotSet(this.#anyHandlers);

    const errors: unknown[] = [];

    for (const record of specificSnapshot) {
      try {
        record.raw(payload);
      } catch (err) {
        errors.push(err);
      }
    }

    for (const record of anySnapshot) {
      try {
        record.raw(event, payload);
      } catch (err) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `[@nimble-api/eventhub] ${errors.length} handler(s) threw errors for "${event}"`);
    }
  }

  async emitSerial<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    this.#checkDestroyed();

    const specificHandlers = this.#handlers.get(event);
    const specificSnapshot = specificHandlers ? snapshotSet(specificHandlers) : [];
    const anySnapshot = snapshotSet(this.#anyHandlers);

    for (const record of specificSnapshot) {
      await record.raw(payload);
    }

    for (const record of anySnapshot) {
      await record.raw(event, payload);
    }
  }

  // === Promise 等待 ===

  waitFor<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T[K]> {
    return this.once(event, opts);
  }

  // === AsyncIterable ===

  events<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; bufferMax?: number },
  ): AsyncIterable<T[K]> {
    const self = this;
    const maxBuffer = opts?.bufferMax ?? 1000;
    return {
      [Symbol.asyncIterator](): AsyncIterator<T[K]> {
        const queue: T[K][] = [];
        let resolveNext: ((v: IteratorResult<T[K]>) => void) | null = null;
        let done = false;

        const complete = (): void => {
          done = true;
          unsub();
          if (resolveNext) {
            resolveNext({ value: undefined, done: true });
            resolveNext = null;
          }
        };

        const unsub = self.on(
          event,
          (payload: T[K]) => {
            if (resolveNext) {
              resolveNext({ value: payload, done: false });
              resolveNext = null;
            } else {
              if (queue.length >= maxBuffer) {
                queue.shift(); // drop oldest
              }
              queue.push(payload);
            }
          },
          { signal: opts?.signal },
        );

        if (opts?.signal) {
          if (opts.signal.aborted) {
            complete();
          } else {
            opts.signal.addEventListener('abort', complete, { once: true });
          }
        }

        return {
          async next(): Promise<IteratorResult<T[K]>> {
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            if (done) return { value: undefined, done: true };
            return new Promise<IteratorResult<T[K]>>((resolve) => {
              resolveNext = resolve;
            });
          },
          async return(): Promise<IteratorResult<T[K]>> {
            complete();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  // === 查询 ===

  listenerCount(event?: keyof T & string): number {
    if (this.#destroyed) return 0;
    if (event) {
      return this.#handlers.get(event)?.size ?? 0;
    }
    let total = this.#anyHandlers.size;
    for (const set of this.#handlers.values()) {
      total += set.size;
    }
    return total;
  }

  eventNames(): (keyof T & string)[] {
    if (this.#destroyed) return [];
    return [...this.#handlers.keys()] as (keyof T & string)[];
  }

  // === 生命周期 ===

  clear(): void {
    this.#handlers.clear();
    this.#anyHandlers.clear();
  }

  dispose(): void {
    this.#destroyed = true;
    this.#handlers.clear();
    this.#anyHandlers.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === 私有方法 ===

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/eventhub] Instance is destroyed');
  }

  #emitMeta<K extends keyof MetaEventPayloads>(
    event: K,
    payload: MetaEventPayloads[K],
  ): void {
    const set = this.#handlers.get(event);
    if (!set || set.size === 0) return;

    this.#emittingMeta = true;
    try {
      for (const record of snapshotSet(set)) {
        try { record.raw(payload); } catch { /* meta handler errors are silently ignored */ }
      }
    } finally {
      this.#emittingMeta = false;
    }
  }
}
