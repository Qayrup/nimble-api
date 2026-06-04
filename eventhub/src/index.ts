import { EventHub } from './event-hub';
import type { SubscribeOptions, Unsubscribe } from './core/types';
import type { EventHubOptions } from './event-hub';
export { EventHub };
export type { SubscribeOptions, Unsubscribe, EventHubOptions };

export function createEventHub<T = Record<string, unknown>>(options?: EventHubOptions): EventHub<T> {
  return new EventHub<T>(options);
}
