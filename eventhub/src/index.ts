import { EventHub } from './event-hub';
import type { SubscribeOptions, Unsubscribe } from './core/types';
export { EventHub };
export type { SubscribeOptions, Unsubscribe };

export function createEventHub<T = Record<string, unknown>>(): EventHub<T> {
  return new EventHub<T>();
}
