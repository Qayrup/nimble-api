export interface ConcurrencyLimiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** Number of currently running tasks */
  readonly running: number;
  /** Number of queued (not yet started) tasks */
  readonly pending: number;
  /** Clear all queued tasks. Running tasks are unaffected. */
  clear(): void;
}

export function createConcurrencyLimit(limit: number): ConcurrencyLimiter {
  if (limit < 1) throw new Error('Concurrency limit must be >= 1');

  let running = 0;
  const queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];

  const next = (): void => {
    if (queue.length === 0 || running >= limit) return;
    const task = queue.shift()!;
    running++;
    task.fn()
      .then(task.resolve, task.reject)
      .finally(() => {
        running--;
        next();
      });
  };

  const limiter = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      next();
    });

  return Object.defineProperties(limiter, {
    running: { get: () => running, enumerable: true },
    pending: { get: () => queue.length, enumerable: true },
    clear: {
      value: () => {
        while (queue.length > 0) {
          queue.shift()!.reject(new Error('Queue cleared'));
        }
      },
      enumerable: true,
    },
  }) as ConcurrencyLimiter;
}
