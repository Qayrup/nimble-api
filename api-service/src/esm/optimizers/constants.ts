export const OPTIMIZE_TYPES = {
  DEBOUNCE: 'debounce',
  THROTTLE: 'throttle',
  SWITCH_LOCK: 'switchLock',
  LINK_LOCK: 'linkLock',
  RETURN_CONTROL: 'return',
  DEBOUNCE_THROTTLE: 'debounceThrottle'
} as const;

export type OptimizeType = (typeof OPTIMIZE_TYPES)[keyof typeof OPTIMIZE_TYPES];
