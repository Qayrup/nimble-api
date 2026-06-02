import { ApiService, apiProxyHandler } from './esm/apiService/apiService';
import { setEventBus } from './esm/apiService/baseApi';
import type { ApiConfig, ApiSettings } from './esm/apiService/baseApi';
import { initAdvancedEvent } from '@nimble-api/eventhub';

export { OPTIMIZE_TYPES } from './esm/optimizers/constants';
export type { OptimizeType } from './esm/optimizers/constants';

// 工厂函数：创建新实例
export function createApiService(
  apiConfig: ApiConfig = {},
  settings: ApiSettings = {}
): ApiService {
  return new Proxy(new ApiService(apiConfig, settings), apiProxyHandler) as unknown as ApiService;
}

// 单例实例
let singletonInstance: ApiService | null = null;

// 单例初始化
export function initApiService(
  userConfig: ApiConfig = {},
  settings: ApiSettings = {}
): ApiService {
  if (singletonInstance !== null) {
    return singletonInstance;
  }
  singletonInstance = createApiService(userConfig, settings);

  // 自动初始化事件总线连接
  try {
    const eventHub = initAdvancedEvent();
    setEventBus(eventHub as unknown as { emit: (key: string, payload: unknown) => unknown });
  } catch (e) {
    console.warn('[@nimble-api/api-service] 事件总线初始化失败，事件派发功能不可用:', e);
  }

  return singletonInstance;
}

// 获取单例
export function getApiService(): ApiService {
  if (!singletonInstance) {
    throw new Error('请先调用 initApiService 初始化API服务');
  }
  return singletonInstance;
}

// 销毁单例
export function destroyApiService(): void {
  if (singletonInstance) {
    singletonInstance.destroy();
    singletonInstance = null;
  }
  setEventBus(null);
}

const proxyHandler: ProxyHandler<object> = {
  get(_target, prop, _receiver) {
    if (!singletonInstance) {
      throw new Error('请先调用 initApiService 初始化API服务');
    }
    const val = Reflect.get(singletonInstance as object, prop, _receiver);
    if (typeof val === 'function') {
      return val.bind(singletonInstance);
    }
    return val;
  },
  set() {
    throw new Error('ApiService is read-only. Modifications blocked.');
  },
  deleteProperty() {
    throw new Error('ApiService is read-only. Deletions blocked.');
  }
};

export default new Proxy({}, proxyHandler) as ApiService;
