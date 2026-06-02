import { AdvancedEventEmitter } from './esm/index';
import type { EventHubSettings, FlowMode } from './esm/index';
export type { FlowMode };

let singletonInstance: AdvancedEventEmitter | undefined;

// 工厂函数：创建新实例
export function createAdvancedEvent(
  eventConfig: Record<string, unknown> = {},
  settings: EventHubSettings = {}
): AdvancedEventEmitter {
  return new AdvancedEventEmitter(eventConfig, settings);
}

// 单例初始化
export function initAdvancedEvent(
  userConfig: Record<string, unknown> = {},
  settings: EventHubSettings = {}
): AdvancedEventEmitter {
  if (singletonInstance != null) {
    console.warn('EventHub已初始化，返回现有实例');
    return singletonInstance;
  }
  singletonInstance = createAdvancedEvent(userConfig, settings);
  return singletonInstance;
}

type ProxyHandler = {
  get(_target: object, prop: string | symbol): unknown;
  set(): never;
  deleteProperty(): never;
};

const proxyHandler: ProxyHandler = {
  get(_target, prop) {
    const val = Reflect.get(singletonInstance as object, prop);
    if (typeof val === 'function') {
      return val.bind(singletonInstance);
    }
    return val;
  },
  set: () => {
    throw new Error('EventHub is read-only. Modifications blocked.');
  },
  deleteProperty: () => {
    throw new Error('EventHub is read-only. Deletions blocked.');
  }
};

export default new Proxy({}, proxyHandler) as AdvancedEventEmitter;
