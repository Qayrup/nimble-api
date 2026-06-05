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
    };

    if (signal) {
      if (signal.aborted) {
        reject(new PollCanceledError());
        return;
      }
      signal.addEventListener('abort', () => {
        cleanup();
        reject(new PollCanceledError());
      }, { once: true });
    }

    const tick = async (): Promise<void> => {
      if (aborted) return;

      attempts++;
      if (attempts > maxAttempts) {
        reject(new PollTimeoutError(maxAttempts, interval));
        return;
      }

      let data: T;
      try {
        data = await fn();
      } catch (err) {
        reject(err);
        return;
      }

      if (stopIf?.(data)) {
        reject(new PollFailedError(data));
        return;
      }

      if (until(data)) {
        resolve(data);
        return;
      }

      timer = setTimeout(tick, interval);
    };

    tick();
  });
}
