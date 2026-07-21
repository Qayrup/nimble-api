import { PollCanceledError, PollTimeoutError, PollFailedError } from './errors';

export interface PollOptions<T> {
  interval: number;
  until: (data: T) => boolean;
  maxAttempts?: number;
  stopIf?: (data: T) => boolean;
  signal?: AbortSignal;
}

export function poll<T>(
  fn: () => Promise<T>,
  options: PollOptions<T>,
): Promise<T> {
  const { interval, until, maxAttempts = Infinity, stopIf, signal } = options;

  return new Promise<T>((resolve, reject) => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted = false;

    const cleanup = (): void => {
      aborted = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      cleanup();
      reject(new PollCanceledError());
    };

    if (signal) {
      if (signal.aborted) {
        reject(new PollCanceledError());
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const settle = (fn: () => void): void => {
      cleanup();
      fn();
    };

    const tick = async (): Promise<void> => {
      if (aborted) return;

      attempts++;
      if (attempts > maxAttempts) {
        settle(() => reject(new PollTimeoutError(attempts - 1, interval)));
        return;
      }

      let data: T;
      try {
        data = await fn();
      } catch (err) {
        if (aborted) return;
        settle(() => reject(err));
        return;
      }

      if (aborted) return;

      if (stopIf?.(data)) {
        settle(() => reject(new PollFailedError(data)));
        return;
      }

      if (until(data)) {
        settle(() => resolve(data));
        return;
      }

      timer = setTimeout(tick, interval);
    };

    tick();
  });
}
