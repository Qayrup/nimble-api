// 3.2.1创建流量控制器（防抖/节流逻辑）
export function createFlowController(eventType, handler, mode, delay) {
  // 3.2.1 流量控制状态管理对象
  const controlState = {
    lastExecuted: 0,      // 记录上一次执行的时间戳（用于节流）
    scheduledTask: null,   // 存储定时器ID（用于重置延迟执行）
    pendingParams: null,   // 缓存事件触发时的参数（确保最新参数被处理）
    eventIdentifier: eventType, // 关联事件标识
    isPending: false      // 标记当前是否有等待执行的任务（节流中避免重复设延迟）
  }

  // 3.2.2 实际执行任务的封装
  const executeTask = params => {
    controlState.lastExecuted = Date.now()  // 更新最后执行时间为当前时刻
    controlState.isPending = false          // 重置等待状态
    clearTimeout(controlState.scheduledTask) // 清除残留定时器（避免重复执行）
    handler(...params)                      // 执行原始事件处理函数
  }

  /* 3.2.4防抖逻辑实现（debounce）
   * 原理：连续触发时重置计时器，仅最后一次触发后延迟执行
   */
  const debounceLogic = (...params) => {
    // performanceMonitor.startTrace(eventType) // 开始性能追踪（记录事件触发）
    controlState.pendingParams = params      // 保存最新参数
    controlState.isPending = true            // 标记为等待执行状态
    clearTimeout(controlState.scheduledTask) // 清除旧定时器（关键：重新计时）

    // 设置新定时器（延迟结束后执行任务）
    controlState.scheduledTask = setTimeout(() => {
      executeTask(params)                   // 执行处理函数
      // performanceMonitor.finalizeTrace(eventType) // 结束性能追踪
    }, delay)
  }

  /* 3.2.4节流逻辑实现（throttle）
   * 原理：固定时间间隔内仅执行一次，结合立即执行+延迟执行补最后一次
   */
  const throttleLogic = (...params) => {
    // performanceMonitor.startTrace(eventType)  // 开始性能追踪
    const currentTime = Date.now()            // 获取当前时间戳
    controlState.pendingParams = params      // 保存最新参数

    // 条件1：当前无等待任务且超过延迟时间 → 立即执行
    if (!controlState.isPending && currentTime - controlState.lastExecuted >= delay) {
      executeTask(params)
      // performanceMonitor.finalizeTrace(eventType)
    }
    // 条件2：若无活跃定时器 → 设置延迟任务补最后一次触发
    else if (!controlState.scheduledTask) {
      // 计算剩余等待时间（确保间隔精准）
      const remaining = delay - (currentTime - controlState.lastExecuted)
      controlState.scheduledTask = setTimeout(() => {
        executeTask(controlState.pendingParams) // 执行缓存的参数
        // performanceMonitor.finalizeTrace(eventType)
      }, remaining)
    }
  }

  // 返回对应的控制器函数
  const controller = mode === 'debounce' ? debounceLogic : throttleLogic
  controller.controlState = controlState  // 暴露状态对象（便于外部调试）
  return controller
}