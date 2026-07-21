import type { RetryConfig } from './core/types';

export const DEFAULT_RETRY: Required<RetryConfig> = {
  limit: 2,
  methods: ['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS'],
  statusCodes: [408, 413, 429, 500, 502, 503, 504],
  backoff: 'exponential',
  baseDelay: 1000,
  maxDelay: 30000,
};

export function calcBackoff(config: RetryConfig, attempt: number): number {
  const base = config.baseDelay ?? DEFAULT_RETRY.baseDelay;
  const max = config.maxDelay ?? DEFAULT_RETRY.maxDelay;
  const backoff = config.backoff ?? DEFAULT_RETRY.backoff;

  const delay = backoff === 'exponential'
    ? base * Math.pow(2, attempt - 1)
    : base;

  return Math.min(delay, max) + Math.random() * 200;
}

export function shouldRetry(
  config: RetryConfig,
  status: number | undefined,
  method: string,
): boolean {
  const methods = config.methods ?? DEFAULT_RETRY.methods;
  if (!methods.includes(method.toUpperCase())) return false;

  if (status != null && status !== 0) {
    const statusCodes = config.statusCodes ?? DEFAULT_RETRY.statusCodes;
    return statusCodes.includes(status);
  }

  // Network errors (no status, or status=0) are always retriable for allowed methods
  return true;
}
