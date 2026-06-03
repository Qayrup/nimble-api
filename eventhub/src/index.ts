import { EventHub } from './event-hub';
import type { EventMap, SubscribeOptions, Unsubscribe } from './core/types';
export { EventHub };
export type { EventMap, SubscribeOptions, Unsubscribe };

export function createEventHub<T extends EventMap = Record<string, unknown>>(): EventHub<T> {
  return new EventHub<T>();
}
