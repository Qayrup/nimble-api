export type WrappedHandler = {
  originalRef?: (...args: unknown[]) => unknown;
  controlState?: {
    scheduledTask?: ReturnType<typeof setTimeout> | null;
    isPending: boolean;
  };
  (...args: unknown[]): void;
};

// 兼容多端的高精度时间获取方法
export const getCurrentTime = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
};

