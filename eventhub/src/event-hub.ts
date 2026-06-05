import { globToRegex } from './utils/glob';
import type { SubscribeOptions, Unsubscribe, MetaEventPayloads } from './core/types';

type AnyHandler = (...args: unknown[]) => void;

function wrapDebounce(fn: AnyHandler, ms: number): AnyHandler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: unknown[]) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
}

function wrapThrottle(fn: AnyHandler, ms: number): AnyHandler {
  let lastTime = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  return (...args: unknown[]) => {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      if (trailing !== undefined) { clearTimeout(trailing); trailing = undefined; }
      fn(...args);
    } else if (trailing === undefined) {
      trailing = setTimeout(() => {
        trailing = undefined;
        lastTime = Date.now();
        fn(...args);
      }, ms - (now - lastTime));
    }
  };
}

interface HandlerRecord {
  raw: AnyHandler;
}

interface WildcardRecord {
  pattern: string;
  regex: RegExp;
  record: HandlerRecord;
}

export interface EventHubOptions {
  delimiter?: string;
}

export class EventHub<T = Record<string, unknown>> {
  #handlers = new Map<string, HandlerRecord[]>();
  #anyHandlers: HandlerRecord[] = [];
  #wildcardHandlers: WildcardRecord[] = [];
  #destroyed = false;
  #emittingMeta = false;
  #maxListeners: number = Infinity;
  #warned = new Set<string>();
  #delimiter: string;

  constructor(options?: EventHubOptions) {
    this.#delimiter = options?.delimiter ?? ':./';
  }

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

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw };

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }
    this.#handlers.get(event)!.push(record);

    this.#checkMaxListeners(event);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event });
    }

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(record);
        if (idx !== -1) handlers.splice(idx, 1);
        if (handlers.length === 0) this.#handlers.delete(event);
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

  onPattern(
    pattern: string,
    handler: (event: string, payload: T[keyof T]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const regex = globToRegex(pattern, this.#delimiter);
    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw };
    const wc: WildcardRecord = { pattern, regex, record };
    this.#wildcardHandlers.push(wc);

    this.#checkMaxListeners(pattern);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event: pattern });
    }

    const unsub = (): void => {
      const idx = this.#wildcardHandlers.indexOf(wc);
      if (idx !== -1) this.#wildcardHandlers.splice(idx, 1);
      if (!this.#emittingMeta) {
        this.#emitMeta('listenerRemoved', { event: pattern });
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  prependListener<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw };

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }
    this.#handlers.get(event)!.unshift(record);

    this.#checkMaxListeners(event);

    this.#checkMaxListeners(event);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event });
    }

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(record);
        if (idx !== -1) handlers.splice(idx, 1);
        if (handlers.length === 0) this.#handlers.delete(event);
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

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw };
    this.#anyHandlers.push(record);

    this.#checkMaxListeners('*');
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event: '*' });
    }

    const unsub = (): void => {
      const idx = this.#anyHandlers.indexOf(record);
      if (idx !== -1) this.#anyHandlers.splice(idx, 1);
      if (!this.#emittingMeta) {
        this.#emitMeta('listenerRemoved', { event: '*' });
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  // === 一次性 ===

  once<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; timeout?: number; filter?: (payload: T[K]) => boolean },
  ): Promise<T[K]> {
    this.#checkDestroyed();

    const signal = opts?.signal;
    if (signal?.aborted) {
      const err = new Error('[@nimble-api/eventhub] once() aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }

    return new Promise<T[K]>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsub = this.on(
        event,
        (payload) => {
          if (opts?.filter && !opts.filter(payload)) return;
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          unsub();
          resolve(payload);
        },
      );

      if (opts?.timeout != null) {
        timeoutId = setTimeout(() => {
          unsub();
          const err = new Error('[@nimble-api/eventhub] once() timed out');
          err.name = 'TimeoutError';
          reject(err);
        }, opts.timeout);
      }

      if (signal) {
        signal.addEventListener(
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

  many<K extends keyof T & string>(
    event: K,
    n: number,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    let count = 0;

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }

    const wrappedHandler = this.#wrapHandler(handler as AnyHandler, opts);

    const wrapped: HandlerRecord = {
      raw: ((payload: T[K]) => {
        wrappedHandler(payload);
        count++;
        if (count >= n) {
          const handlers = this.#handlers.get(event);
          if (handlers) {
            const idx = handlers.indexOf(wrapped);
            if (idx !== -1) handlers.splice(idx, 1);
            if (handlers.length === 0) this.#handlers.delete(event);
          }
          if (!this.#emittingMeta) {
            this.#emitMeta('listenerRemoved', { event });
          }
        }
      }) as AnyHandler,
    };

    this.#handlers.get(event)!.push(wrapped);

    this.#checkMaxListeners(event);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event });
    }

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(wrapped);
        if (idx !== -1) handlers.splice(idx, 1);
        if (handlers.length === 0) this.#handlers.delete(event);
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

  // === 取消订阅 ===

  off<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
  ): void {
    if (this.#destroyed) return;
    const handlers = this.#handlers.get(event);
    if (!handlers) return;

    for (let i = 0; i < handlers.length; i++) {
      if (handlers[i].raw === (handler as AnyHandler)) {
        handlers.splice(i, 1);
        if (handlers.length === 0) this.#handlers.delete(event);
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
      // Also remove wildcard handlers with exact pattern match
      for (let i = this.#wildcardHandlers.length - 1; i >= 0; i--) {
        if (this.#wildcardHandlers[i].pattern === event) {
          this.#wildcardHandlers.splice(i, 1);
          this.#emitMeta('listenerRemoved', { event });
        }
      }
    } else {
      const names = [...this.#handlers.keys()].filter(
        n => n !== 'listenerAdded' && n !== 'listenerRemoved',
      );
      for (const name of names) {
        this.#emitMeta('listenerRemoved', { event: name });
      }
      this.#handlers.clear();

      for (const wh of this.#wildcardHandlers) {
        this.#emitMeta('listenerRemoved', { event: wh.pattern });
      }
      this.#wildcardHandlers.length = 0;

      if (this.#anyHandlers.length > 0) {
        this.#emitMeta('listenerRemoved', { event: '*' });
      }
      this.#anyHandlers.length = 0;
    }
  }

  // === 发射 ===

  emit<K extends keyof T & string>(event: K, payload: T[K]): void {
    this.#checkDestroyed();

    const specificHandlers = this.#handlers.get(event);
    const specificSnapshot = specificHandlers ? specificHandlers.slice() : [];
    const wildcardSnapshot = this.#wildcardHandlers.slice();
    const anySnapshot = this.#anyHandlers.slice();

    const errors: unknown[] = [];

    for (const record of specificSnapshot) {
      try {
        record.raw(payload);
      } catch (err) {
        errors.push(err);
      }
    }

    for (const wh of wildcardSnapshot) {
      if (!wh.regex.test(event)) continue;
      try {
        wh.record.raw(event, payload);
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
    const specificSnapshot = specificHandlers ? specificHandlers.slice() : [];
    const wildcardSnapshot = this.#wildcardHandlers.slice();
    const anySnapshot = this.#anyHandlers.slice();

    for (const record of specificSnapshot) {
      await record.raw(payload);
    }

    for (const wh of wildcardSnapshot) {
      if (!wh.regex.test(event)) continue;
      await wh.record.raw(event, payload);
    }

    for (const record of anySnapshot) {
      await record.raw(event, payload);
    }
  }

  async emitAsync<K extends keyof T & string>(
    event: K,
    payload: T[K],
  ): Promise<PromiseSettledResult<unknown>[]> {
    this.#checkDestroyed();

    const specificHandlers = this.#handlers.get(event);
    const specificSnapshot = specificHandlers ? specificHandlers.slice() : [];
    const wildcardSnapshot = this.#wildcardHandlers.slice();
    const anySnapshot = this.#anyHandlers.slice();

    const promises: Promise<unknown>[] = [];

    for (const record of specificSnapshot) {
      promises.push(Promise.resolve().then(() => record.raw(payload)));
    }

    for (const wh of wildcardSnapshot) {
      if (!wh.regex.test(event)) continue;
      promises.push(Promise.resolve().then(() => wh.record.raw(event, payload)));
    }

    for (const record of anySnapshot) {
      promises.push(Promise.resolve().then(() => record.raw(event, payload)));
    }

    return Promise.allSettled(promises);
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
    const maxBuffer = opts?.bufferMax ?? 1000;
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<T[K]> => {
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

        const unsub = this.on(
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

  listeners<K extends keyof T & string>(event?: K): ((payload: T[K]) => void)[] {
    if (this.#destroyed) return [];

    if (event) {
      const result: AnyHandler[] = [];
      const handlers = this.#handlers.get(event);
      if (handlers) {
        for (const rec of handlers) result.push(rec.raw);
      }
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) result.push(wh.record.raw);
      }
      return result as ((payload: T[K]) => void)[];
    }

    const result: AnyHandler[] = [];
    for (const handlers of this.#handlers.values()) {
      for (const rec of handlers) result.push(rec.raw);
    }
    for (const wh of this.#wildcardHandlers) {
      result.push(wh.record.raw);
    }
    for (const rec of this.#anyHandlers) {
      result.push(rec.raw);
    }
    return result as ((payload: T[K]) => void)[];
  }

  listenerCount(event?: keyof T & string): number {
    if (this.#destroyed) return 0;
    if (event) {
      let count = this.#handlers.get(event)?.length ?? 0;
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) count++;
      }
      return count;
    }
    let total = this.#anyHandlers.length + this.#wildcardHandlers.length;
    for (const handlers of this.#handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  eventNames(): (keyof T & string)[] {
    if (this.#destroyed) return [];
    const names = [...this.#handlers.keys()] as (keyof T & string)[];
    for (const wh of this.#wildcardHandlers) {
      names.push(wh.pattern as keyof T & string);
    }
    return names;
  }

  setMaxListeners(n: number): void {
    this.#maxListeners = n;
  }

  getMaxListeners(): number {
    return this.#maxListeners;
  }

  // === 流控链 ===

  debounce(ms: number) {
    return {
      on: <K extends keyof T & string>(
        event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions,
      ) => this.on(event, handler, { ...opts, debounce: ms }),
      onPattern: (
        pattern: string, handler: (event: string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onPattern(pattern, handler, { ...opts, debounce: ms }),
      onAny: (
        handler: (event: keyof T & string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onAny(handler, { ...opts, debounce: ms }),
    };
  }

  throttle(ms: number) {
    return {
      on: <K extends keyof T & string>(
        event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions,
      ) => this.on(event, handler, { ...opts, throttle: ms }),
      onPattern: (
        pattern: string, handler: (event: string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onPattern(pattern, handler, { ...opts, throttle: ms }),
      onAny: (
        handler: (event: keyof T & string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onAny(handler, { ...opts, throttle: ms }),
    };
  }

  // === 生命周期 ===

  clear(): void {
    this.#handlers.clear();
    this.#anyHandlers.length = 0;
    this.#wildcardHandlers.length = 0;
  }

  dispose(): void {
    this.#destroyed = true;
    this.#handlers.clear();
    this.#anyHandlers.length = 0;
    this.#wildcardHandlers.length = 0;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === 私有方法 ===

  #wrapHandler(handler: AnyHandler, opts?: SubscribeOptions): AnyHandler {
    let wrapped = handler;
    // Do NOT apply both — throttle takes precedence if both are set
    if (opts?.throttle != null) {
      wrapped = wrapThrottle(wrapped, opts.throttle);
    } else if (opts?.debounce != null) {
      wrapped = wrapDebounce(wrapped, opts.debounce);
    }
    return wrapped;
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/eventhub] Instance is destroyed');
  }

  #checkMaxListeners(event: string): void {
    if (this.#maxListeners === Infinity) return;
    const count = this.listenerCount(event as keyof T & string);
    if (count > this.#maxListeners && !this.#warned.has(event)) {
      this.#warned.add(event);
      console.warn(
        `[@nimble-api/eventhub] MaxListenersExceededWarning: Possible EventHub memory leak detected. ` +
        `${count} listeners added to "${event}". Use setMaxListeners() to increase limit.`,
      );
    }
  }

  #emitMeta<K extends keyof MetaEventPayloads>(
    event: K,
    payload: MetaEventPayloads[K],
  ): void {
    const handlers = this.#handlers.get(event);
    if (!handlers || handlers.length === 0) return;

    this.#emittingMeta = true;
    try {
      for (const record of handlers.slice()) {
        try { record.raw(payload); } catch { /* meta handler errors are silently ignored */ }
      }
    } finally {
      this.#emittingMeta = false;
    }
  }
}
