import { AdvancedEventEmitter } from './esm/index.js'

let singletonInstance;
// 工厂函数：创建新实例
export function createAdvancedEvent(apiConfig = {}, settings = {}) {
  return new AdvancedEventEmitter(apiConfig, settings)
}
// 单例初始化
export function initAdvancedEvent(userConfig = {}, settings = {}) {
  if (singletonInstance != null) {
    console.warn('API服务已初始化，返回现有实例');
    return singletonInstance;
  }
  singletonInstance = createAdvancedEvent(userConfig, settings);
  return singletonInstance;
}
const proxyHandler = {
  get(target, prop) {
    const val = Reflect.get(singletonInstance, prop);
    if (typeof val === 'function') {
      return val.bind(singletonInstance);
    }
    return val;
  },
  set: () => {
    throw new Error('ApiService is read-only. Modifications blocked.');
  },
  deleteProperty: () => {
    throw new Error('ApiService is read-only. Deletions blocked.');
  }
}
export default new Proxy({}, proxyHandler)