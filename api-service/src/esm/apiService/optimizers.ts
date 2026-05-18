export interface MethodWithMethodId<T = unknown> {
  (...args: unknown[]): Promise<T>;
  methodId?: symbol;
}

interface LockProxy {
  value: boolean;
}

interface DebounceState {
  timer: ReturnType<typeof setTimeout> | null;
  lastResolve: ((value: unknown) => void) | null;
  lastReject: ((reason: unknown) => void) | null;
}

interface ThrottleState {
  lastCall: number;
  lastPromise: Promise<unknown> | null;
}

/**
 * 优化器集成模块
 *
 * 与 frequencyControl.ts 中独立工具函数的区别：
 * - 本文件优化器基于 methodId + 共享 Map 管理状态，多实例可复用
 * - 节流为首边缘（leading edge）实现：首个调用立即执行，窗口内后续调用共享同一 Promise
 * - 用于 ApiService.optimize() 链式调用
 * - frequencyControl.ts 为尾随边缘（trailing edge）setTimeout 实现，可脱离 ApiService 使用
 */

/**
 * 防抖优化器
 */
export function debounceOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  debounceCache: Map<symbol, DebounceState>,
  wait: number = 3000
): MethodWithMethodId<T> {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建防抖：缺少方法标识符');

  if (!debounceCache.has(methodId)) {
    debounceCache.set(methodId, {
      timer: null,
      lastResolve: null,
      lastReject: null
    });
  }

  const debounceState = debounceCache.get(methodId)!;

  const wrapped = function (this: unknown, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // 拒绝上一次未完成的 Promise，防止悬挂 Promise 导致内存泄漏
      if (debounceState.lastReject) {
        const prevReject = debounceState.lastReject;
        prevReject(new Error('Debounced: superseded by newer call'));
      }

      if (debounceState.timer) clearTimeout(debounceState.timer);

      debounceState.lastResolve = resolve as (value: unknown) => void;
      debounceState.lastReject = reject as (reason: unknown) => void;

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

  // 传播 methodId，以便后续优化器（如 throttle）可以使用
  wrapped.methodId = methodId;
  return wrapped;
}

/**
 * 节流优化器
 */
export function throttleOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  throttleCache: Map<symbol, ThrottleState>,
  wait: number = 300
): MethodWithMethodId<T> {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建节流：缺少方法标识符');

  if (!throttleCache.has(methodId)) {
    throttleCache.set(methodId, {
      lastCall: 0,
      lastPromise: null
    });
  }

  const throttleState = throttleCache.get(methodId)!;

  const wrapped = function (this: unknown, ...args: unknown[]): Promise<T> {
    const now = Date.now();

    // 在节流窗口期内，返回上一个Promise
    if (now - throttleState.lastCall < wait && throttleState.lastPromise) {
      return throttleState.lastPromise as Promise<T>;
    }

    throttleState.lastCall = now;
    throttleState.lastPromise = method.apply(this, args);

    return throttleState.lastPromise as Promise<T>;
  };

  // 传播 methodId
  wrapped.methodId = methodId;
  return wrapped;
}

/**
 * 开关锁优化器
 */
export function switchLockOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  switchLockMap: Map<symbol, LockProxy>,
  proxy?: LockProxy
): MethodWithMethodId<T> {
  const methodId = method.methodId;
  if (!methodId) throw new Error('无法为方法创建锁：缺少方法标识符');

  let lock: LockProxy;
  if (proxy) {
    lock = proxy;
  } else {
    if (!switchLockMap.has(methodId)) {
      switchLockMap.set(methodId, { value: false });
    }
    lock = switchLockMap.get(methodId)!;
  }

  const wrapped = async function (this: unknown, ...args: unknown[]): Promise<T> {
    if (lock.value) return null as T;
    try {
      lock.value = true;
      return await method.apply(this, args);
    } finally {
      lock.value = false;
    }
  };

  (wrapped as MethodWithMethodId).methodId = methodId;
  return wrapped;
}

/**
 * 链路锁优化器
 */
export function linkLockOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  proxy?: LockProxy
): MethodWithMethodId<T> {
  const lock = proxy || { value: false };

  const wrapped = async function (this: unknown, ...args: unknown[]): Promise<T> {
    if (lock.value) {
      throw new Error('请求被限流：操作进行中');
    }

    try {
      lock.value = true;
      return await method.apply(this, args);
    } finally {
      lock.value = false;
    }
  };

  (wrapped as MethodWithMethodId).methodId = method.methodId;
  return wrapped;
}

/**
 * 返回值控制优化器
 */
export function returnControlOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  shouldReturn: boolean = true
): MethodWithMethodId<T> {
  const wrapped = async function (this: unknown, ...args: unknown[]): Promise<T> {
    const result = await method.apply(this, args);
    return (shouldReturn ? result : undefined) as T;
  };

  (wrapped as MethodWithMethodId).methodId = method.methodId;
  return wrapped;
}

/**
 * 防抖+节流组合优化器
 * 先防抖后节流，methodId 通过 debounceOptimizer 传播给 throttleOptimizer
 */
export function debounceThrottleOptimizer<T = unknown>(
  method: MethodWithMethodId<T>,
  debounceCache: Map<symbol, DebounceState>,
  throttleCache: Map<symbol, ThrottleState>,
  wait: number = 300
): MethodWithMethodId<T> {
  const debounced = debounceOptimizer(method, debounceCache, wait);
  return throttleOptimizer(debounced, throttleCache, wait);
}

export default {
  debounceOptimizer,
  throttleOptimizer,
  switchLockOptimizer,
  linkLockOptimizer,
  returnControlOptimizer,
  debounceThrottleOptimizer
};
