

// 兼容多端的高精度时间获取方法
export const getCurrentTime = () => {
  // 优先使用performance API获取高精度时间，否则降级使用Date.now()
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()
}



export function isDuplicateHandler(listenerGroup, handler) {
  return Array.from(listenerGroup).some(wrapper => wrapper.originalRef === handler)
}



export function dellistenerHandler(listenerGroup, handler) {
  for (const wrapper of listenerGroup) {
    if (wrapper.originalRef !== handler) continue;
    // 清理定时任务和状态
    if (wrapper.controlState?.scheduledTask) {
      clearTimeout(wrapper.controlState.scheduledTask)
      wrapper.controlState.isPending = false
    }
    listenerGroup.delete(wrapper)
  }
}