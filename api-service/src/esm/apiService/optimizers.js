/**
 * 优化器模块，提供防抖、节流、锁等API优化功能
 * @module optimizers
 */

/**
 * 防抖优化器
 * @param {Function} method - 原始API方法
 * @param {Map} debounceCache - 防抖状态缓存
 * @param {number} wait - 等待时间(ms)
 * @returns {Function} 防抖处理后的方法
 */
export function debounceOptimizer(method, debounceCache, wait = 3000) {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建防抖：缺少方法标识符');
  
  // 初始化或获取防抖状态
  if (!debounceCache.has(methodId)) {
    debounceCache.set(methodId, {
      timer: null,
      lastResolve: null,
      lastReject: null
    });
  }
  
  const debounceState = debounceCache.get(methodId);
  
  return function(...args) {
    return new Promise((resolve, reject) => {
      // 清除前一个定时器
      clearTimeout(debounceState.timer);
      
      // 保存当前的resolve/reject
      debounceState.lastResolve = resolve;
      debounceState.lastReject = reject;
      
      // 设置新定时器
      debounceState.timer = setTimeout(async () => {
        try {
          const result = await method.apply(this, args);
          if (debounceState.lastResolve === resolve) {
            resolve(result);
          }
        } catch (error) {
          if (debounceState.lastReject === reject) {
            reject(error);
          }
        } finally {
          debounceState.timer = null;
          debounceState.lastResolve = null;
          debounceState.lastReject = null;
        }
      }, wait);
    });
  };
}

/**
 * 节流优化器
 * @param {Function} method - 原始API方法
 * @param {Map} throttleCache - 节流状态缓存
 * @param {number} wait - 间隔时间(ms)
 * @returns {Function} 节流处理后的方法
 */
export function throttleOptimizer(method, throttleCache, wait = 300) {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建节流：缺少方法标识符');
  
  // 初始化或获取节流状态
  if (!throttleCache.has(methodId)) {
    throttleCache.set(methodId, {
      lastCall: 0,
      lastPromise: null
    });
  }
  
  const throttleState = throttleCache.get(methodId);
  
  return function(...args) {
    const now = Date.now();
    
    // 在节流窗口期内，返回上一个Promise
    if (now - throttleState.lastCall < wait && throttleState.lastPromise) {
      return throttleState.lastPromise;
    }
    
    throttleState.lastCall = now;
    throttleState.lastPromise = method.apply(this, args)
      .then(result => {
        throttleState.lastPromise = null;
        return result;
      })
      .catch(error => {
        throttleState.lastPromise = null;
        throw error;
      });
    
    return throttleState.lastPromise;
  };
}

/**
 * 开关锁优化器
 * @param {Function} method - 原始API方法
 * @param {Map} switchLockMap - 锁状态缓存
 * @param {Object} [proxy] - 外部锁对象
 * @returns {Function} 带锁控制的方法
 */
export function switchLockOptimizer(method, switchLockMap, proxy) {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建锁：缺少方法标识符');
  
  let lock;
  if (proxy) {
    lock = proxy;
  } else {
    // 初始化或获取锁状态
    if (!switchLockMap.has(methodId)) {
      switchLockMap.set(methodId, { value: false });
    }
    lock = switchLockMap.get(methodId);
  }
  
  return async function(...args) {
    if (lock.value) return console.log('请求被限流：操作进行中')
    try {
      lock.value = true;
      return await method.apply(this, args);
    } finally {
      lock.value = false;
    }
  };
}

/**
 * 链路锁优化器
 * @param {Function} method - 原始API方法
 * @param {Object} [proxy] - 外部锁对象
 * @returns {Function} 带锁控制的方法
 */
export function linkLockOptimizer(method, proxy) {
  // 使用外部锁或创建内部锁
  const lock = proxy || { value: false };
  
  return async function(...args) {
    if (lock.value) {
      console.log('请求被限流：操作进行中');
      throw new Error('请求被限流：操作进行中');
    }
    
    try {
      lock.value = true;
      return await method.apply(this, args);
    } finally {
      lock.value = false;
    }
  };
}

/**
 * 返回值控制优化器
 * @param {Function} method - 原始API方法
 * @param {boolean} shouldReturn - 是否返回值
 * @returns {Function} 返回值控制的方法
 */
export function returnControlOptimizer(method, shouldReturn = true) {
  return async function(...args) {
    const result = await method.apply(this, args);
    return shouldReturn ? result : undefined;
  };
}

/**
 * 防抖+节流组合优化器
 * @param {Function} method - 原始API方法
 * @param {Map} debounceCache - 防抖状态缓存
 * @param {Map} throttleCache - 节流状态缓存
 * @param {number} wait - 时间间隔(ms)
 * @returns {Function} 组合优化后的方法
 */
export function debounceThrottleOptimizer(
  method, 
  debounceCache, 
  throttleCache, 
  wait = 300
) {
  const debounced = debounceOptimizer(method, debounceCache, wait);
  return throttleOptimizer(debounced, throttleCache, wait);
}

// 确保导出所有函数
export default {
  debounceOptimizer,
  throttleOptimizer,
  switchLockOptimizer,
  linkLockOptimizer,
  returnControlOptimizer,
  debounceThrottleOptimizer
};