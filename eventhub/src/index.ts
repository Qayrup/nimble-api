import { EventEmitter } from './core/EventEmitter';
import type { EventMap, EventHubSettings } from './core/types';

export { EventEmitter };

export type {
  EventMap,
  EventHandler,
  WildcardHandler,
  ListenerOptions,
  Middleware,
  PrefixKeys,
  EventHubSettings,
} from './core/types';

let singletonInstance: EventEmitter<Record<string, unknown>> | undefined;

export function createEventHub<T extends EventMap = Record<string, unknown>>(
  settings?: EventHubSettings,
): EventEmitter<T> {
  return new EventEmitter<T>(settings);
}

export function initEventHub<T extends EventMap = Record<string, unknown>>(
  settings?: EventHubSettings,
): EventEmitter<T> {
  if (singletonInstance) {
    console.warn('[@nimble-api/eventhub] Already initialized, returning existing instance');
    return singletonInstance as unknown as EventEmitter<T>;
  }
  singletonInstance = new EventEmitter<Record<string, unknown>>(settings);
  return singletonInstance as unknown as EventEmitter<T>;
}

export function destroyEventHub(): void {
  singletonInstance?.destroy();
  singletonInstance = undefined;
}

const proxyHandler: ProxyHandler<object> = {
  get(_target, prop) {
    if (!singletonInstance) {
      throw new Error(
        '[@nimble-api/eventhub] Not initialized. Call initEventHub() first.',
      );
    }
    const val = Reflect.get(singletonInstance as object, prop);
    if (typeof val === 'function') {
      return val.bind(singletonInstance);
    }
    return val;
  },
  set: () => {
    throw new Error('[@nimble-api/eventhub] is read-only.');
  },
  deleteProperty: () => {
    throw new Error('[@nimble-api/eventhub] is read-only.');
  },
};

export default new Proxy({}, proxyHandler) as EventEmitter;
