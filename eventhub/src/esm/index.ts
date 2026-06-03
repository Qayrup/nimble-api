import { isValidObj } from './validate';
import { safeObjectsToStrings, stringsToObject } from './objectTransformation';
import { EnhancedPathPrefixMatcher } from './PathPrefixMatcher';
import { BUILT } from './BuiltEvent';
import { PerformanceMonitor } from './performanceMonitor';
import { createFlowController } from './flowController';
import type { FlowControlledHandler } from './flowController';
import { getCurrentTime } from './utils';
import type { WrappedHandler } from './utils';
import { deBug } from './executionError';

function normalizeMode(mode: FlowMode): 'debounce' | 'throttle' {
  return mode === 't' ? 'throttle' : mode === 'd' ? 'debounce' : mode;
}

export interface EventHubSettings {
  enableAsyncHandling?: boolean;
  strictMode?: boolean;
  maxListeners?: number;
  maxNamespaceBatchSize?: number;
  defaultThrottle?: number;
  defaultDebounce?: number;
  enabled?: boolean;
}

export type FlowMode = 'debounce' | 'throttle' | 't' | 'd';

export interface ListenerOptions {
  mode?: FlowMode;
  timing?: number;
  once?: boolean;
}

export type EventHandler = (...args: unknown[]) => void;

type InternalHandler = WrappedHandler | FlowControlledHandler;

// 增强型事件总线核心类
export class AdvancedEventEmitter {
  // 动态生成的事件键对象（运行时结构由用户配置决定，无法静态约束）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EVENTKEY: Record<string, any> = {};

  // 私有属性初始化
  #listeners = new Map<string, Map<EventHandler, InternalHandler>>();
  #pathPrefixMatcher: EnhancedPathPrefixMatcher | null = null;

  /** 路径前缀匹配器 getter — 初始化后保证非空 */
  get #matcher(): EnhancedPathPrefixMatcher {
    return this.#pathPrefixMatcher as EnhancedPathPrefixMatcher;
  }
  #config: Required<EventHubSettings> = {
    enableAsyncHandling: true,
    strictMode: false,
    maxListeners: 200,
    maxNamespaceBatchSize: 500,
    defaultThrottle: 150,
    defaultDebounce: 250,
    enabled: false
  };
  #deBug: (msg: string, eventType?: string, handler?: unknown) => never = deBug;
  #monitor = new PerformanceMonitor();

  // 实例化
  constructor(eventConfig: Record<string, unknown> = {}, settingConfig: EventHubSettings = {}) {
    // 判断是否为普通对象,不是则报错
    if (!isValidObj(eventConfig)) this.#deBug('eventConfig必定为普通对象');
    // 转化为路径数组
    const paths = safeObjectsToStrings({ eventConfig, BUILT });
    // 将转化的数组返回一个绝对正确的路径对象
    this.EVENTKEY = stringsToObject(paths) as Record<string, unknown>;
    // 初始化事件注册表
    this.#initializeEventRegistry(paths);
    // 配置设置（校验防止未知配置项）
    const validKeys: (keyof EventHubSettings)[] = ['enableAsyncHandling', 'strictMode', 'maxListeners', 'maxNamespaceBatchSize', 'defaultThrottle', 'defaultDebounce', 'enabled'];
    for (const key of Object.keys(settingConfig)) {
      if (!(validKeys as string[]).includes(key)) {
        throw new Error(`未知配置项: ${key}，有效配置项: ${validKeys.join(', ')}`);
      }
    }
    Object.assign(this.#config, settingConfig);
    this.#monitor.toggle(settingConfig.enabled ?? false);
  }

  // 初始化事件注册表（从配置中提取所有事件类型）
  #initializeEventRegistry(eventConfig: string[]): void {
    eventConfig.forEach(event => this.#listeners.set(event, new Map()));
    this.#pathPrefixMatcher ??= new EnhancedPathPrefixMatcher(Array.from(this.#listeners.keys()));
  }

  #registered(eventType: string, handler: EventHandler, config: ListenerOptions = {}): void {
    const listenerGroup = this.#listeners.get(eventType);
    if (!listenerGroup) return;
    if (listenerGroup.size >= this.#config.maxListeners)
      return this.#deBug('事件监听器超出最大限制', this.EVENTKEY.BUILT.ERROR.LISTENER_OVERFLOW, eventType);
    if (listenerGroup.has(handler))
      return this.#deBug('重复注册相同处理器', this.EVENTKEY.BUILT.ERROR.LISTENER_REPEAT, eventType);
    listenerGroup.set(handler, this.#applyHandlerWrapper(eventType, handler, config));
  }

  // 核心事件订阅方法（单事件类型和配置选项）
  onKey(eventType: string, handler: EventHandler, config: ListenerOptions = {}): this {
    this.#validateHandler(handler, eventType);
    this.#validateEventKey(eventType);
    this.#registered(eventType, handler, config);
    return this;
  }

  // 名称空间添加监听
  onAll(eventType: string, handler: EventHandler, config: ListenerOptions = {}): this {
    this.#validateHandler(handler, eventType);
    this.#validateEventKey(eventType, true);
    // 获取该名称空间下,所有的注册事件key
    const eventKeys = this.#matcher.getPathsByPrefix(eventType);
    // 批量注册上限保护
    if (eventKeys.length > this.#config.maxNamespaceBatchSize) {
      this.#deBug(`命名空间批量注册超过上限: ${eventType} (${eventKeys.length}个事件)`, this.EVENTKEY.BUILT.ERROR.LISTENER_OVERFLOW);
    }
    // 将所有的事件侦听注册
    eventKeys.forEach(v => this.#registered(v, handler, config));
    return this;
  }

  // 核心事件订阅方法（支持多事件类型和配置选项）
  on(eventType: string, handler: EventHandler, config: ListenerOptions = {}): this {
    this.#validateHandler(handler, eventType);
    this.#validateEventKey(eventType);
    if (this.#matcher.isPathPrefix(eventType))
      return this.onAll(eventType, handler, config);
    return this.onKey(eventType, handler, config);
  }

  emit(eventType: string, ...payload: unknown[]): this {
    this.#validateEventKey(eventType);
    const handlers = this.#listeners.get(eventType);
    if (!handlers || handlers.size === 0) return this;

    if (this.#config.enabled) {
      this.#monitor.startTrace(eventType);
      for (const handler of handlers.values()) {
        this.#monitor.recordInvocation(eventType);
        const start = getCurrentTime();
        try {
          handler(...payload);
        } catch (error) {
          try {
            this.#deBug(String(error), eventType, (handler as WrappedHandler).originalRef || handler);
          } catch {
            console.error(`[@nimble-api/eventhub] Unhandled error for event "${eventType}":`, error);
          }
        } finally {
          this.#monitor.updateDuration(eventType, getCurrentTime() - start);
        }
      }
    } else {
      for (const handler of handlers.values()) {
        try {
          handler(...payload);
        } catch (error) {
          try {
            this.#deBug(String(error), eventType, (handler as WrappedHandler).originalRef || handler);
          } catch {
            console.error(`[@nimble-api/eventhub] Unhandled error for event "${eventType}":`, error);
          }
        }
      }
    }

    return this;
  }

  off(eventType: string, handler: EventHandler): this {
    if (this.#matcher.isPathPrefix(eventType))
      return this.offAll(eventType, handler);
    return this.offKey(eventType, handler);
  }

  offAll(eventType: string, handler: EventHandler): this {
    this.#validateEventKey(eventType, true);
    this.#validateHandler(handler, eventType);
    const eventKeys = this.#matcher.getPathsByPrefix(eventType);
    eventKeys.forEach(v => this.#removeListener(v, handler));
    return this;
  }

  // 移除事件侦听
  #removeListener(eventType: string, handler: EventHandler): void {
    const listenerGroup = this.#listeners.get(eventType);
    if (!listenerGroup) return;
    const wrapper = listenerGroup.get(handler);
    if (wrapper) {
      const state = (wrapper as WrappedHandler).controlState;
      if (state?.scheduledTask) {
        clearTimeout(state.scheduledTask);
        state.isPending = false;
      }
      listenerGroup.delete(handler);
    }
    if (!this.#config.strictMode && listenerGroup.size !== 0) return;
    this.#listeners.delete(eventType);
  }

  offKey(eventType: string, handler: EventHandler): this {
    this.#validateEventKey(eventType);
    this.#validateHandler(handler, eventType);
    this.#removeListener(eventType, handler);
    return this;
  }

  getEventKey(): Readonly<Record<string, unknown>> {
    return Object.freeze(this.EVENTKEY);
  }

  // === 非核心api ===

  // 设置监听器上限
  setListenerLimit(limit: number): this {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('监听器上限必须为至少1的整数');
    }
    this.#config.maxListeners = limit;
    return this;
  }

  setDeBug(fun: (msg: string, eventType?: string, handler?: unknown) => never): void {
    this.#deBug = fun;
  }

  // 销毁实例，清理所有监听器、定时器和状态
  destroy(): void {
    for (const handlers of this.#listeners.values()) {
      for (const handler of handlers.values()) {
        const state = (handler as WrappedHandler).controlState;
        if (state?.scheduledTask) {
          clearTimeout(state.scheduledTask);
          state.isPending = false;
        }
      }
    }
    this.#listeners.clear();
    this.#pathPrefixMatcher?.clear();
    this.EVENTKEY = {};
    this.#monitor.resetAll();
  }

  // 获取性能指标
  getMetrics(eventType: string) {
    return this.#monitor.getMetrics(eventType);
  }

  // === 验证以及处理工厂 ===

  // 验证处理器有效性
  #validateHandler(handler: unknown, eventType: string): void {
    if (typeof handler === 'function') return;
    this.#deBug('事件处理器必须为函数', eventType);
  }

  // 安全验证方法
  #validateEventKey(eventType: string, isNamespace = false): void {
    if (isNamespace) return this.#validateNamespace(eventType);
    return this.#validateEventType(eventType);
  }

  #validateEventType(eventType: string): void {
    const isEvent = this.#listeners.has(eventType);
    if (isEvent) return;
    const isStrictMode = this.#config.strictMode;
    if (isStrictMode) return this.#deBug(`未注册的事件: ${eventType}`);
    this.#listeners.set(eventType, new Map());
    this.#pathPrefixMatcher?.addPath(eventType);
  }

  #validateNamespace(eventType: string): void {
    if (!this.#config.strictMode) return;
    if (!this.#matcher.isPathPrefix(eventType))
      return this.#deBug(`未注册的命名空间事件: ${eventType}`);
  }

  // 处理器包装流水线
  #applyHandlerWrapper(
    eventType: string,
    originalHandler: EventHandler,
    config: ListenerOptions
  ): InternalHandler {
    let wrappedHandler: InternalHandler = originalHandler as WrappedHandler;

    // 流量控制模式（防抖/节流）
    if (config.mode) {
      const mode = normalizeMode(config.mode);
      const timing = config.timing ?? this.#getTimingConfig(mode);
      wrappedHandler = createFlowController(eventType, originalHandler, mode, timing);
    }

    // 异步错误处理包装
    if (this.#config.enableAsyncHandling && isAsyncFunction(wrappedHandler)) {
      wrappedHandler = this.#wrapAsyncHandler(wrappedHandler, eventType);
    }

    // 单次执行包装
    if (config.once) {
      const tempWrapper: WrappedHandler = (...params: unknown[]) => {
        wrappedHandler(...params);
        this.off(eventType, originalHandler);
      };
      tempWrapper.originalRef = originalHandler;
      return tempWrapper;
    }

    // 挂载原始处理器引用
    (wrappedHandler as WrappedHandler).originalRef = originalHandler;
    return wrappedHandler;
  }

  // 获取默认时间配置
  #getTimingConfig(mode: 'debounce' | 'throttle'): number {
    return mode === 'debounce' ? this.#config.defaultDebounce : this.#config.defaultThrottle;
  }

  // 异步错误处理包装器
  #wrapAsyncHandler(handler: InternalHandler, eventType: string): InternalHandler {
    const asyncWrapper = async (...params: unknown[]) => {
      try {
        await (handler as (...args: unknown[]) => Promise<unknown>)(...params);
      } catch (error) {
        try {
          this.#deBug(String(error), eventType, handler);
        } catch {
          console.error(`[@nimble-api/eventhub] Unhandled async error for event "${eventType}":`, error);
        }
      }
    };
    return asyncWrapper as unknown as InternalHandler;
  }
}

function isAsyncFunction(fn: unknown): boolean {
  return Object.prototype.toString.call(fn) === '[object AsyncFunction]';
}

export default AdvancedEventEmitter;
