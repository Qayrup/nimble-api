import type { ApiPlugin } from '../core/types';

export function createCacheSWRPlugin(): ApiPlugin {
  return {
    name: 'cache-swr',

    async onRequest(ctx) {
      if (ctx.config.cacheMode === 'swr' && ctx.config.cacheTTL) {
        ctx.headers['x-cache-mode'] = 'swr';
      }
      return ctx;
    },

    async onResponse(ctx) {
      return ctx;
    },
  };
}
