import type { ApiPlugin } from '../core/types';

export function createRetryPlugin(): ApiPlugin {
  return {
    name: 'retry',

    async onError(ctx) {
      return ctx;
    },
  };
}
