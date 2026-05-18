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

export function isDuplicateHandler(
  listenerGroup: Set<WrappedHandler>,
  handler: (...args: unknown[]) => unknown
): boolean {
  for (const wrapper of listenerGroup) {
    if (wrapper.originalRef === handler) return true;
  }
  return false;
}

export function dellistenerHandler(
  listenerGroup: Set<WrappedHandler>,
  handler: (...args: unknown[]) => unknown
): void {
  for (const wrapper of listenerGroup) {
    if (wrapper.originalRef !== handler) continue;
    // 清理定时任务和状态
    if (wrapper.controlState?.scheduledTask) {
      clearTimeout(wrapper.controlState.scheduledTask);
      wrapper.controlState.isPending = false;
    }
    listenerGroup.delete(wrapper);
  }
}
