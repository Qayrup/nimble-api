import { snapshotSet } from '../features/snapshot';
import { createMiddlewareChain } from './middleware';
import type {
  EventMap,
  EventHandler,
  WildcardHandler,
  ListenerOptions,
  Middleware,
  PrefixKeys,
  EventHubSettings,
} from './types';

type HandlerRecord<T extends EventMap> = {
  handler: EventHandler<T, keyof T> | WildcardHandler<T>;
  raw: (...args: unknown[]) => void;
  once: boolean;
};

type PrefixRecord = {
  prefix: string;
  raw: (event: string, payload: unknown) => void;
  once: boolean;
  unsub: () => void;
};

export class EventEmitter<T extends EventMap = Record<string, unknown>> {
  #handlers = new Map<string, Set<HandlerRecord<T>>>();
  #wildcards = new Set<HandlerRecord<T>>();
  #prefixes: PrefixRecord[] = [];
  #middlewares: Middleware<T>[] = [];
  #config: Required<EventHubSettings> = {
    strictMode: false,
    maxListeners: 200,
  };

  #destroyed = false;

  constructor(settings: EventHubSettings = {}) {
    if (settings.strictMode !== undefined) this.#config.strictMode = settings.strictMode;
    if (settings.maxListeners !== undefined) this.#config.maxListeners = settings.maxListeners;
  }

  // === 订阅 ===

  on<K extends keyof T>(event: K & string, handler: EventHandler<T, K>, opts?: ListenerOptions): () => void;
  on(event: '*', handler: WildcardHandler<T>, opts?: ListenerOptions): () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: any, opts: ListenerOptions = {}): () => void {
    this.#checkDestroyed();
    this.#validateHandler(handler);

    const record: HandlerRecord<T> = {
      handler: handler as HandlerRecord<T>['handler'],
      raw: opts.once
        ? (...args: unknown[]) => {
            (handler as (...a: unknown[]) => void)(...args);
            unsub();
          }
        : handler,
      once: opts.once ?? false,
    };

    if (event === '*') {
      this.#checkOverflow(this.#wildcards.size);
      this.#wildcards.add(record);
    } else {
      this.#ensureEvent(event);
      const set = this.#handlers.get(event)!;
      this.#checkOverflow(set.size);
      set.add(record);
    }

    const unsub = (): void => {
      if (event === '*') {
        this.#wildcards.delete(record);
      } else {
        this.#handlers.get(event)?.delete(record);
      }
    };

    if (opts.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  onPrefix<P extends string>(
    prefix: P,
    handler: (event: PrefixKeys<T, P>, payload: T[PrefixKeys<T, P>]) => void,
    opts?: ListenerOptions,
  ): () => void {
    this.#checkDestroyed();
    this.#validateHandler(handler);

    const record: PrefixRecord = {
      prefix,
      raw: (event: string, payload: unknown) => {
        (handler as (...args: unknown[]) => void)(event, payload);
      },
      once: opts?.once ?? false,
      unsub: () => {
        const idx = this.#prefixes.indexOf(record);
        if (idx !== -1) this.#prefixes.splice(idx, 1);
      },
    };

    this.#prefixes.push(record);

    if (opts?.signal) {
      opts.signal.addEventListener('abort', record.unsub, { once: true });
    }

    return record.unsub;
  }

  // === 取消订阅 ===

  off<K extends keyof T>(event: K & string): this;
  off(event: '*'): this;
  off(event: string): this {
    if (this.#destroyed) return this;
    if (event === '*') {
      this.#wildcards.clear();
    } else {
      this.#handlers.delete(event);
    }
    return this;
  }

  // === 发射 ===

  emit<K extends keyof T>(event: K & string, payload: T[K]): this {
    this.#checkDestroyed();

    if (this.#config.strictMode && !this.#handlers.has(event)) {
      throw new Error(`[@nimble-api/eventhub] Unregistered event: ${event}`);
    }

    const chain = createMiddlewareChain(this.#middlewares);
    const dispatch = (): void => {
      const specificHandlers = this.#handlers.get(event);
      const specificSnapshot = specificHandlers ? snapshotSet(specificHandlers) : [];
      const wildcardSnapshot = snapshotSet(this.#wildcards);
      const prefixSnapshot = [...this.#prefixes];

      for (const record of specificSnapshot) {
        try { record.raw(payload); } catch (err) {
          console.error(`[@nimble-api/eventhub] Error in handler for "${event}":`, err);
        }
      }

      for (const record of wildcardSnapshot) {
        try { record.raw(event, payload); } catch (err) {
          console.error(`[@nimble-api/eventhub] Error in wildcard handler for "${event}":`, err);
        }
      }

      for (const record of prefixSnapshot) {
        if (event.startsWith(record.prefix)) {
          try { record.raw(event, payload); } catch (err) {
            console.error(`[@nimble-api/eventhub] Error in prefix handler "${record.prefix}" for "${event}":`, err);
          }
          if (record.once) record.unsub();
        }
      }
    };

    chain(event, payload, dispatch);
    return this;
  }

  // === Promise 等待 ===

  waitFor<K extends keyof T>(
    event: K & string,
    opts?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T[K]> {
    this.#checkDestroyed();

    return new Promise<T[K]>((resolve, reject) => {
      const timeoutId: ReturnType<typeof setTimeout> | undefined =
        opts?.timeout != null
          ? setTimeout(() => {
              unsub();
              reject(new DOMException('waitFor timed out', 'TimeoutError'));
            }, opts.timeout)
          : undefined;

      const unsub = this.on(
        event,
        (payload) => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          unsub();
          resolve(payload);
        },
        { signal: opts?.signal },
      );

      if (opts?.signal) {
        opts.signal.addEventListener(
          'abort',
          () => {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            unsub();
            reject(new DOMException('waitFor aborted', 'AbortError'));
          },
          { once: true },
        );
      }
    });
  }

  // === AsyncIterable 流 ===

  events<K extends keyof T>(
    event: K & string,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<T[K]> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
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

  // === 中间件 ===

  use(middleware: Middleware<T>): () => void {
    this.#checkDestroyed();
    this.#middlewares.push(middleware);
    return () => {
      const idx = this.#middlewares.indexOf(middleware);
      if (idx !== -1) this.#middlewares.splice(idx, 1);
    };
  }

  // === 查询 ===

  listenerCount<K extends keyof T>(event: K & string): number;
  listenerCount(event: '*'): number;
  listenerCount(event: string): number {
    if (this.#destroyed) return 0;
    if (event === '*') return this.#wildcards.size;
    return this.#handlers.get(event)?.size ?? 0;
  }

  // === 销毁 ===

  destroy(): void {
    this.#destroyed = true;
    this.#handlers.clear();
    this.#wildcards.clear();
    this.#prefixes.length = 0;
    this.#middlewares.length = 0;
  }

  // === 私有方法 ===

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/eventhub] Instance is destroyed');
  }

  #validateHandler(handler: unknown): void {
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }
  }

  #checkOverflow(current: number): void {
    if (current >= this.#config.maxListeners) {
      throw new Error(
        `[@nimble-api/eventhub] Max listeners (${this.#config.maxListeners}) exceeded`,
      );
    }
  }

  #ensureEvent(event: string): void {
    if (!this.#handlers.has(event)) {
      if (this.#config.strictMode) {
        throw new Error(`[@nimble-api/eventhub] Unregistered event: ${event}`);
      }
      this.#handlers.set(event, new Set());
    }
  }
}

export default EventEmitter;
