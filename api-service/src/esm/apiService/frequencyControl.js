// ------------------ 频率控制
/**
 * 异步防抖函数
 * @param {Function} func - 目标函数
 * @param {number} wait - 等待时间(毫秒)
 * @returns {Function} 防抖包装函数
 */
export function debounce(func, wait) {
  let timer = null;
  let lastResolve = null;
  let lastReject = null;
  return function(...args) {
    return new Promise((resolve, reject) => {
      clearTimeout(timer);
      
      // 保存当前调用的resolve和reject
      lastResolve = resolve;
      lastReject = reject;
      
      timer = setTimeout(async () => {
        try {
          const result = await func.apply(this, args);
          lastResolve?.(result);
        } catch (error) {
          lastReject?.(error);
        } finally {
          lastResolve = null;
          lastReject = null;
        }
      }, wait);
    });
  };
}

/**
 * 异步节流函数
 * @param {Function} func - 目标函数
 * @param {number} wait - 间隔时间(毫秒)
 * @returns {Function} 节流包装函数
 */
export function throttle(func, wait) {
  let lastExec = 0;
  let timer = null;
  let pendingResolve = null;
  let pendingReject = null;
  return function(...args) {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const context = this;
      // 清除之前等待的调用
      if (timer) {
        clearTimeout(timer);
        pendingReject?.(new Error('Throttled call skipped'));
        pendingResolve = null;
        pendingReject = null;
      }
      
      if (now - lastExec >= wait) {
        // 立即执行
        lastExec = now;
        func.apply(context, args).then(resolve).catch(reject);
      } else {
        // 设置延迟执行
        pendingResolve = resolve;
        pendingReject = reject;
        timer = setTimeout(() => {
          func.apply(context, args)
            .then(pendingResolve)
            .catch(pendingReject);
          lastExec = Date.now();
          timer = null;
          pendingResolve = null;
          pendingReject = null;
        }, wait - (now - lastExec));
      }
    });
  };
}

/**
 * 防抖节流组合函数
 * @param {Function} func - 目标函数
 * @param {number} wait - 节流间隔/防抖延迟时间(毫秒)
 * @returns {Function} 组合包装函数
 */
export function debounceThrottle(func, wait) {
  let lastExec = 0;
  let timer = null;
  let lastArgs, lastContext;
  let pendingResolve = null;
  let pendingReject = null;
  async function execute() {
    try {
      const result = await func.apply(lastContext, lastArgs);
      pendingResolve?.(result);
    } catch (error) {
      pendingReject?.(error);
    } finally {
      lastExec = Date.now();
      pendingResolve = null;
      pendingReject = null;
    }
  }
  return function(...args) {
    return new Promise((resolve, reject) => {
      lastArgs = args;
      lastContext = this;
      pendingResolve = resolve;
      pendingReject = reject;
      const now = Date.now();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (now - lastExec >= wait) {
        execute();
      } else {
        timer = setTimeout(() => {
          if (Date.now() - lastExec >= wait) {
            execute();
          }
          timer = null;
        }, wait);
      }
    });
  };
}