import type { ApiPlugin } from '../core/types';

export function createEntityCachePlugin(): ApiPlugin {
  return {
    name: 'entity-cache',

    async onResponse(ctx) {
      if (ctx.config.entities && ctx.data) {
        // Entity cache update is handled in ApiClient core
      }
      return ctx;
    },
  };
}
