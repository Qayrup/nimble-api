/**
 * 优化类型常量
 */
export const OPTIMIZE_TYPES = {
  DEBOUNCE: 'debounce',
  THROTTLE: 'throttle',
  SWITCH_LOCK: 'switchLock',
  LINK_LOCK: 'linkLock',
  RETURN_CONTROL: 'return',
  DEBOUNCE_THROTTLE: 'debounceThrottle'
};

/**
 * 默认优化参数
 */
export const DEFAULT_OPTIMIZATION_PARAMS = {
  DEBOUNCE: 3000,
  THROTTLE: 300,
  DEBOUNCE_THROTTLE: 300
};