import { getCurrentTime } from './utils.js'
// 性能追踪模块（生产环境可配置关闭）
export const performanceMonitor = {
  metrics: new Map(),    // 存储性能指标数据
  enabled: true,         // 性能监控开关

  // 开始追踪事件性能
  startTrace(event) {
    this.trace(event)
  },
  startTraceAcc(event) {
    if (this.metrics.has(event + 'acc')) return
    this.trace(event)
  },
  trace(event) {
    if (!this.enabled) return
    this.metrics.set(event, {
      startTime: getCurrentTime(), // 记录开始时间
      invocationCount: 0,          // 调用次数
      maxDuration: 0,               // 最大持续时间
      totalDuration: 0             // 总持续时间
    })
  },

  // 记录事件调用次数
  recordInvocation(event) {
    if (!this.enabled) return
    const metric = this.metrics.get(event)
    if (metric) metric.invocationCount++
  },

  // 更新持续时间统计
  updateDuration(event, duration) {
    if (!this.enabled) return
    const metric = this.metrics.get(event)
    if (metric) {
      metric.totalDuration += duration
      if (duration > metric.maxDuration) {
        metric.maxDuration = duration
      }
    }
  },

  // 完成追踪并计算最终持续时间
  finalizeTrace(event) {
    if (!this.enabled) return
    const metric = this.metrics.get(event)
    if (!metric) return
    const duration = getCurrentTime() - metric.startTime
    this.updateDuration(event, duration)
  },

  // 获取性能指标数据
  getMetrics(event) {
    const metric = this.metrics.get(event)
    return metric ? {
      calls: metric.invocationCount,          // 调用次数
      avg: metric.totalDuration / metric.invocationCount || 0, // 平均耗时
      max: metric.maxDuration,                // 最大耗时
      total: metric.totalDuration
    } : null
  },

  // 切换性能监控开关
  toggle(enabled) {
    this.enabled = enabled
  }
}