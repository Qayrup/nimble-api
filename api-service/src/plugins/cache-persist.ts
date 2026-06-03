import type { ApiPlugin } from '../core/types';

export function createCachePersistPlugin(): ApiPlugin {
  return {
    name: 'cache-persist',

    setup(_client) {
      // Load persisted cache on startup
    },

    teardown() {
      // Flush cache to storage on teardown
    },
  };
}
