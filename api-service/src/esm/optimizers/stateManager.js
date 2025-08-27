/**
 * 优化状态管理器
 * 集中管理所有优化相关的状态
 */
class OptimizerStateManager {
  constructor() {
    // 优化配置存储
    this.optimizationConfig = new Map();
    // 全局锁状态
    this.switchLockMap = new Map();
    // 防抖缓存状态
    this.debounceCache = new Map();
    // 节流缓存状态
    this.throttleCache = new Map();
  }
  
  /**
   * 获取或创建方法的优化状态
   * @param {string} type - 优化类型
   * @param {Function} method - API方法
   * @param {*} defaultValue - 默认状态值
   * @returns {*} 优化状态
   */
  getOrCreateState(type, method, defaultValue) {
    const methodId = method.methodId;
    if (!methodId) {
      throw new Error(`无法为方法创建${type}状态：缺少方法标识符`);
    }
    
    const stateKey = `${type}_${methodId}`;
    
    switch (type) {
      case 'switchLock':
        if (!this.switchLockMap.has(stateKey)) {
          this.switchLockMap.set(stateKey, defaultValue || { value: false });
        }
        return this.switchLockMap.get(stateKey);
        
      case 'debounce':
        if (!this.debounceCache.has(stateKey)) {
          this.debounceCache.set(stateKey, defaultValue || {
            timer: null,
            lastResolve: null,
            lastReject: null
          });
        }
        return this.debounceCache.get(stateKey);
        
      case 'throttle':
        if (!this.throttleCache.has(stateKey)) {
          this.throttleCache.set(stateKey, defaultValue || {
            lastCall: 0,
            lastPromise: null
          });
        }
        return this.throttleCache.get(stateKey);
        
      default:
        throw new Error(`未知的优化类型: ${type}`);
    }
  }
  
  /**
   * 清除所有优化状态
   */
  clearAll() {
    this.optimizationConfig.clear();
    this.switchLockMap.clear();
    this.debounceCache.clear();
    this.throttleCache.clear();
  }
  
  /**
   * 清除特定方法的优化状态
   * @param {Function} method - API方法
   */
  clearMethodState(method) {
    const methodId = method.methodId;
    if (!methodId) return;
    
    const types = ['switchLock', 'debounce', 'throttle'];
    types.forEach(type => {
      const stateKey = `${type}_${methodId}`;
      switch (type) {
        case 'switchLock':
          this.switchLockMap.delete(stateKey);
          break;
        case 'debounce':
          clearTimeout(this.debounceCache.get(stateKey)?.timer);
          this.debounceCache.delete(stateKey);
          break;
        case 'throttle':
          this.throttleCache.delete(stateKey);
          break;
      }
    });
  }
}

// 导出单例状态管理器
export default new OptimizerStateManager();