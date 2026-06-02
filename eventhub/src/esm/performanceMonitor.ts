import { getCurrentTime } from './utils';

export interface PerformanceMetric {
  startTime: number;
  invocationCount: number;
  maxDuration: number;
  totalDuration: number;
}

export interface PerformanceMetrics {
  calls: number;
  avg: number;
  max: number;
  total: number;
}

export const performanceMonitor = {
  metrics: new Map<string, PerformanceMetric>(),
  enabled: true,

  startTrace(event: string): void {
    if (!this.enabled || this.metrics.has(event)) return;
    this.metrics.set(event, {
      startTime: getCurrentTime(),
      invocationCount: 0,
      maxDuration: 0,
      totalDuration: 0
    });
  },

  recordInvocation(event: string): void {
    if (!this.enabled) return;
    const metric = this.metrics.get(event);
    if (metric) metric.invocationCount++;
  },

  updateDuration(event: string, duration: number): void {
    if (!this.enabled) return;
    const metric = this.metrics.get(event);
    if (metric) {
      metric.totalDuration += duration;
      if (duration > metric.maxDuration) {
        metric.maxDuration = duration;
      }
    }
  },

  getMetrics(event: string): PerformanceMetrics | null {
    const metric = this.metrics.get(event);
    return metric ? {
      calls: metric.invocationCount,
      avg: metric.totalDuration / metric.invocationCount || 0,
      max: metric.maxDuration,
      total: metric.totalDuration
    } : null;
  },

  toggle(enabled: boolean): void {
    this.enabled = enabled;
  },

  reset(event: string): void {
    this.metrics.delete(event);
  },

  resetAll(): void {
    this.metrics.clear();
  }
};
