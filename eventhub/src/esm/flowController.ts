import { getCurrentTime } from './utils';

export interface FlowControlState {
  lastExecuted: number;
  scheduledTask: ReturnType<typeof setTimeout> | null;
  pendingParams: unknown[] | null;
  eventIdentifier: string;
  isPending: boolean;
}

export type FlowControlledHandler = {
  (...params: unknown[]): void;
  controlState: FlowControlState;
};

// 创建流量控制器（防抖/节流逻辑）
export function createFlowController(
  eventType: string,
  handler: (...params: unknown[]) => void,
  mode: 'debounce' | 'throttle',
  delay: number
): FlowControlledHandler {
  // 流量控制状态管理对象
  const controlState: FlowControlState = {
    lastExecuted: 0,
    scheduledTask: null,
    pendingParams: null,
    eventIdentifier: eventType,
    isPending: false
  };

  // 实际执行任务的封装
  const executeTask = (params: unknown[]): void => {
    controlState.lastExecuted = getCurrentTime();
    controlState.isPending = false;
    const task = controlState.scheduledTask;
    controlState.scheduledTask = null;
    if (task) clearTimeout(task);
    handler(...params);
  };

  // 防抖逻辑：连续触发时重置计时器，仅最后一次触发后延迟执行
  const debounceLogic = (...params: unknown[]): void => {
    controlState.pendingParams = params;
    controlState.isPending = true;
    if (controlState.scheduledTask) {
      clearTimeout(controlState.scheduledTask);
    }
    // 设置新定时器，使用 controlState.pendingParams 确保执行最新参数
    controlState.scheduledTask = setTimeout(() => {
      executeTask(controlState.pendingParams ?? params);
    }, delay);
  };

  // 节流逻辑：固定时间间隔内仅执行一次
  const throttleLogic = (...params: unknown[]): void => {
    const currentTime = getCurrentTime();
    controlState.pendingParams = params;

    // 条件1：当前无等待任务且超过延迟时间 → 立即执行
    if (!controlState.isPending && currentTime - controlState.lastExecuted >= delay) {
      executeTask(params);
    }
    // 条件2：若无活跃定时器 → 设置延迟任务补最后一次触发
    else if (!controlState.scheduledTask) {
      const remaining = delay - (currentTime - controlState.lastExecuted);
      controlState.scheduledTask = setTimeout(() => {
        executeTask(controlState.pendingParams ?? params);
      }, remaining);
    }
  };

  const fn = mode === 'debounce' ? debounceLogic : throttleLogic;
  return Object.assign(fn, { controlState }) as FlowControlledHandler;
}
