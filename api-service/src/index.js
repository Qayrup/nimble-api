import './esm/promiseAdditional.js'
import { ApiService, apiProxyHandler } from './esm/apiService/apiService.js'
// 导出优化器类型常量
export const OPTIMIZE_TYPES = {
  DEBOUNCE: 'debounce',
  THROTTLE: 'throttle',
  SWITCH_LOCK: 'switchLock',
  LINK_LOCK: 'linkLock',
  RETURN_CONTROL: 'return',
  DEBOUNCE_THROTTLE: 'debounceThrottle'
};
// 工厂函数：创建新实例
export function createApiService(apiConfig = {}, settings = {}) {
  return new Proxy(new ApiService(apiConfig, settings), apiProxyHandler)
}


// 单例实例
let singletonInstance = {};
// 单例初始化
export function initApiService(userConfig = {}, settings = {}) {
  if (Object.keys(singletonInstance).length !== 0)
    return singletonInstance;
  singletonInstance = createApiService(userConfig, settings);
  return singletonInstance;
}

// 获取单例
export function getApiService() {
  if (!singletonInstance) {
    throw new Error('请先调用 initApiService 初始化API服务');
  }
  return singletonInstance;
}


const proxyHandler = {
  get(_, prop) {
    return Reflect.get(singletonInstance, prop);
  },
  set: () => {
    throw new Error('ApiService is read-only. Modifications blocked.');
  },
  deleteProperty: () => {
    throw new Error('ApiService is read-only. Deletions blocked.');
  }
}

export default new Proxy({}, proxyHandler)

