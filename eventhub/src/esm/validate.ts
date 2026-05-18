/**
 * 验证配置对象是否为普通对象（Plain Object）
 * 排除 null、数组、Date、RegExp 等特殊对象
 */
export function isValidObj(eventConfig: unknown): eventConfig is Record<string, unknown> {
  if (eventConfig === null || typeof eventConfig !== 'object') {
    return false;
  }
  return Object.prototype.toString.call(eventConfig) === '[object Object]';
}

export function isFunction(param: unknown): param is (...args: unknown[]) => unknown {
  return typeof param === 'function';
}
