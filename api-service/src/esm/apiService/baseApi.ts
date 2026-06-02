import { generateCacheKey } from './cacheKeyGenerator';
import optimizers from './optimizers';
import type { MethodWithMethodId } from './optimizers';

// 事件总线（由 initAdvancedEvent 初始化后可用）
let eventBus: { emit: (key: string, payload: unknown) => unknown } | null = null;

export function setEventBus(bus: { emit: (key: string, payload: unknown) => unknown }): void {
  eventBus = bus;
}

export interface ApiConfigItem {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  cacheTTL?: number;
  eventSuccess: string[];
  eventErrors: {
    default: string;
    [code: string]: string;
  };
}

export type ApiConfig = Record<string, ApiConfigItem>;

export interface ApiSettings {
  enableLogging?: boolean;
  fetchTimeout?: number;
}

export interface QueueEvent {
  successEvent: string | null;
  errorEvent: string | null;
  payload: unknown;
  isSuccess: boolean;
}

export type ApiMethodObj<T = unknown> = MethodWithMethodId<T>;

export interface OptimizationConfig {
  type: string;
  args: unknown[];
}

export type ApiMethodWithOptimize<T = unknown> = ApiMethodObj<T> & {
  optimize(type: string, ...params: unknown[]): MethodWithMethodId;
};

interface RequestTask {
  abort?: () => void;
  $easyTry?: () => Promise<[Error | null, unknown]>;
}

// UniApp 全局类型
type UniTaskResult = RequestTask & { then?: (...args: unknown[]) => unknown };
type UniRequestFn = (config: Record<string, unknown>) => UniTaskResult;

function getUni(): { request: UniRequestFn; uploadFile: UniRequestFn } | undefined {
  return (globalThis as Record<string, unknown>).uni as { request: UniRequestFn; uploadFile: UniRequestFn } | undefined;
}

function easyTry<T>(p: Promise<T>): Promise<[null, T] | [Error, null]> {
  return p.then(r => [null, r] as [null, T]).catch(e => [e as Error, null] as [Error, null]);
}

function wrapUniTask(raw: UniTaskResult): RequestTask {
  const promise: Promise<unknown> = typeof raw.then === 'function'
    ? Promise.resolve(raw as unknown as Promise<unknown>)
    : Promise.reject(new Error('UniApp request is not a Promise'));
  return {
    abort: raw.abort?.bind(raw),
    $easyTry: () => easyTry(promise)
  };
}

/**
 * API请求基类，提供统一的请求处理、事件派发和批量处理机制
 */
export class BaseApi {
  /** 事件队列缓存 */
  EVENT_QUEUE: QueueEvent[] = [];
  /** 批量处理定时器句柄 */
  BATCH_TIMER: Promise<void> | null = null;

  apiConfig: ApiConfig;
  enableLogging: boolean;
  fetchTimeout: number;
  cache = new Map<string, unknown>();
  cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();
  inFlightRequests = new Map<string, Promise<unknown>>();
  requestTasks = new Map<string, RequestTask>();
  optimizeProxyCache = new Map<string, Record<string, unknown>>();
  optimizedMethodCache = new Map<string, unknown>();
  switchLockMap = new Map<symbol, { value: boolean }>();
  debounceCache = new Map<symbol, { timer: ReturnType<typeof setTimeout> | null; lastResolve: ((v: unknown) => void) | null; lastReject: ((e: unknown) => void) | null }>();
  throttleCache = new Map<symbol, { lastCall: number; lastPromise: Promise<unknown> | null }>();

  constructor(apiConfig: ApiConfig, settings: ApiSettings = {}) {
    this.apiConfig = apiConfig;
    this.enableLogging = settings.enableLogging ?? false;
    this.fetchTimeout = settings.fetchTimeout ?? 30000;
  }

  /** 子类覆盖此方法以提供API方法查找 */
  getAPIMethod<T = unknown>(_apiKey: string): MethodWithMethodId<T> {
    throw new Error('getAPIMethod 必须由子类实现');
  }

  private static MAX_OPTIMIZE_PROXY_CACHE = 50;

  /**
   * 设置优化配置，返回代理对象支持链式调用
   */
  optimize(type: string, ...args: unknown[]): Record<string, unknown> {
    const cacheKey = `${type}_${JSON.stringify(args)}`;
    if (this.optimizeProxyCache.has(cacheKey)) {
      return this.optimizeProxyCache.get(cacheKey)!;
    }

    // 缓存上限保护：超出时删除最旧的条目
    if (this.optimizeProxyCache.size >= BaseApi.MAX_OPTIMIZE_PROXY_CACHE) {
      const firstKey = this.optimizeProxyCache.keys().next().value as string;
      this.optimizeProxyCache.delete(firstKey);
    }

    const optimization: OptimizationConfig = { type, args };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const proxy: Record<string | symbol, unknown> = new Proxy(this as unknown as Record<string | symbol, unknown>, {
      get(_target, prop) {
        if (prop === 'optimize') {
          return (newType: string, ...newArgs: unknown[]) =>
            (proxy as unknown as BaseApi).optimize(newType, ...newArgs);
        }

        if (typeof prop === 'string' && prop.endsWith('API')) {
          const optimizedKey = `${cacheKey}_${prop}`;
          const cached = self.optimizedMethodCache.get(optimizedKey);
          if (cached !== undefined) return cached;
          const originalMethod = self.getAPIMethod(prop);
          const optimizedMethod = self.applyOptimization(originalMethod, optimization);
          self.optimizedMethodCache.set(optimizedKey, optimizedMethod);
          return optimizedMethod;
        }

        return Reflect.get(_target, prop);
      }
    });

    this.optimizeProxyCache.set(cacheKey, proxy as unknown as Record<string, unknown>);
    return proxy as unknown as Record<string, unknown>;
  }

  /**
   * 应用优化到方法
   */
  applyOptimization<T = unknown>(method: MethodWithMethodId<T>, optimization: OptimizationConfig): MethodWithMethodId<T> | MethodWithMethodId<T | null> {
    switch (optimization.type) {
      case 'debounce':
        return optimizers.debounceOptimizer(method, this.debounceCache, ...optimization.args as [number?]);
      case 'throttle':
        return optimizers.throttleOptimizer(method, this.throttleCache, ...optimization.args as [number?]);
      case 'switchLock':
        return optimizers.switchLockOptimizer(method, this.switchLockMap, ...optimization.args as [{ value: boolean }?]);
      case 'linkLock':
        return optimizers.linkLockOptimizer(method, ...optimization.args as [{ value: boolean }?]);
      case 'return':
        return optimizers.returnControlOptimizer(method, ...optimization.args as [boolean?]);
      case 'debounceThrottle':
        return optimizers.debounceThrottleOptimizer(method, this.debounceCache, this.throttleCache, ...optimization.args as [number?]);
      default:
        return method;
    }
  }

  /**
   * 执行API请求（核心请求方法）
   */
  async makeRequest<T = unknown>(
    apiKey: string,
    params: Record<string, string | number>,
    data: Record<string, unknown>,
    urlBuilder: (params: Record<string, string | number>) => string
  ): Promise<T> {
    const config = this.apiConfig[apiKey];
    if (!config) throw new Error(`Unknown API key: ${apiKey}`);

    const cacheKey = config.cacheTTL ? generateCacheKey(apiKey, params, data) : '';

    if (cacheKey) {
      // 检查缓存是否存在且有效
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) return cached as T;

      // 同 key 的 in-flight 请求去重，复用已有 Promise
      const inFlight = this.inFlightRequests.get(cacheKey);
      if (inFlight !== undefined) return inFlight as Promise<T>;
    }

    // 取消同类型的前序请求（防重复）
    const prevTask = this.requestTasks.get(apiKey);
    if (prevTask && typeof prevTask.abort === 'function') {
      prevTask.abort();
      this.requestTasks.delete(apiKey);
    }

    try {
      const executeRequest = async (): Promise<T> => {
        const url = urlBuilder(params);
        const baseConfig = {
          url,
          method: config.method || 'GET',
          header: {
            'Content-Type': 'application/json',
            ...(config.headers || {})
          }
        };

        let response: [Error | null, unknown];
        let task: RequestTask;

        // 特殊处理文件上传
        if (config.method === 'UPLOAD') {
          const uni = getUni();
          if (!uni) throw new Error('UniApp环境不可用，无法执行上传');
          task = wrapUniTask(uni.uploadFile({
            ...baseConfig,
            filePath: data.file,
            name: 'file'
          }));
          this.requestTasks.set(apiKey, task);
          response = await task.$easyTry!();
        } else {
          const requestConfig = Object.assign(
            baseConfig,
            ['GET', 'DELETE'].includes(config.method!)
              ? { params: data }
              : { data }
          );

          const uni = getUni();
          if (uni) {
            task = wrapUniTask(uni.request(requestConfig));
          } else {
            // 非UniApp环境：使用 fetch 作为回退
            task = fetchRequest(requestConfig, this.fetchTimeout);
          }
          this.requestTasks.set(apiKey, task);
          response = await task.$easyTry!();
        }

        const [rej, res] = response;
        const result = this.handleResponse(apiKey, rej, res as Record<string, unknown> | null);

        if (config.cacheTTL && !rej && (res as Record<string, unknown>)?.code === 200) {
          this.setCache(cacheKey, result, config.cacheTTL);
        }

        return result as T;
      };

      const requestPromise = executeRequest();
      if (config.cacheTTL) {
        this.inFlightRequests.set(cacheKey, requestPromise);
      }
      return await requestPromise;
    } catch (error) {
      if (cacheKey) this.clearCache(cacheKey);
      throw error;
    } finally {
      this.requestTasks.delete(apiKey);
      if (config.cacheTTL) {
        this.inFlightRequests.delete(cacheKey);
      }
    }
  }

  /**
   * 设置缓存
   */
  setCache(key: string, value: unknown, ttl: number): void {
    this.cache.set(key, value);
    this.cacheTimers.set(
      key,
      setTimeout(() => {
        this.cache.delete(key);
        this.cacheTimers.delete(key);
      }, ttl)
    );
  }

  /**
   * 清除指定缓存
   */
  clearCache(key: string): void {
    clearTimeout(this.cacheTimers.get(key));
    this.cache.delete(key);
    this.cacheTimers.delete(key);
  }

  /**
   * 处理响应并触发事件
   */
  handleResponse(apiKey: string, rej: Error | null, res: Record<string, unknown> | null): unknown {
    const config = this.apiConfig[apiKey];
    const result = rej || res;
    const isSuccess = !rej && (res as Record<string, unknown>)?.code === 200;

    if (isSuccess) {
      const successEvents = Array.isArray(config.eventSuccess)
        ? config.eventSuccess
        : [config.eventSuccess];

      successEvents.forEach((sEvent) => {
        if (sEvent) {
          this.queueEvent({
            successEvent: sEvent,
            errorEvent: null,
            payload: result,
            isSuccess: true
          });
        }
      });
    } else {
      const errorEvent = this.getErrorEvent(config, rej ? (rej as Error & { code?: number })?.code : (res as Record<string, unknown>)?.code as number);
      const errorEvents = Array.isArray(errorEvent) ? errorEvent : [errorEvent];

      errorEvents.forEach((eEvent) => {
        if (eEvent) {
          this.queueEvent({
            successEvent: null,
            errorEvent: eEvent,
            payload: result,
            isSuccess: false
          });
        }
      });
    }

    return result;
  }

  /**
   * 获取错误事件类型
   */
  getErrorEvent(config: ApiConfigItem, code?: number): string | undefined {
    return (code !== undefined ? config.eventErrors?.[code] : undefined) || config.eventErrors?.default;
  }

  /**
   * 将事件加入队列（微任务批量处理）
   */
  queueEvent(event: QueueEvent): void {
    this.EVENT_QUEUE.push(event);

    if (!this.BATCH_TIMER) {
      this.BATCH_TIMER = Promise.resolve().then(() => {
        this.flushEvents();
        this.BATCH_TIMER = null;
      });
    }
  }

  /**
   * 批量派发队列中的事件
   */
  flushEvents(): void {
    const events = this.EVENT_QUEUE.splice(0);
    const eventMap = new Map<string, unknown[]>();

    events.forEach(({ successEvent, errorEvent, payload, isSuccess }) => {
      const eventKey = isSuccess ? successEvent : errorEvent;
      if (!eventKey) return;

      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, []);
      }
      eventMap.get(eventKey)!.push(payload);
    });

    // 批量派发合并后的事件到事件总线
    if (eventBus) {
      eventMap.forEach((payloads, eventKey) => {
        const payload = payloads.length > 1 ? payloads : payloads[0];
        eventBus!.emit(eventKey, payload);
      });
    }
  }

  /**
   * 销毁实例，清理所有定时器、缓存和状态，防止内存泄漏
   */
  destroy(): void {
    // 取消待处理的批量派发定时器
    if (this.BATCH_TIMER) {
      this.BATCH_TIMER = null;
    }
    // 清空事件队列
    this.EVENT_QUEUE.length = 0;

    // 中断所有进行中的请求
    for (const task of this.requestTasks.values()) {
      if (typeof task.abort === 'function') {
        task.abort();
      }
    }

    // 清理缓存定时器
    for (const timer of this.cacheTimers.values()) {
      clearTimeout(timer);
    }
    this.cacheTimers.clear();
    this.cache.clear();

    // 清理防抖定时器
    for (const state of this.debounceCache.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.debounceCache.clear();

    // 清理其他状态
    this.throttleCache.clear();
    this.switchLockMap.clear();
    this.inFlightRequests.clear();
    this.requestTasks.clear();
    this.optimizeProxyCache.clear();
    this.optimizedMethodCache.clear();
  }
}

// 非UniApp环境的fetch回退
function fetchRequest(config: Record<string, unknown>, timeout: number): RequestTask {
  let url = config.url as string;
  const method = (config.method as string) || 'GET';
  const headers = config.header as Record<string, string> || {};
  const data = config.data as Record<string, unknown> | undefined;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  // GET/DELETE 请求将 data 参数拼接到 URL query string
  if (data && (method === 'GET' || method === 'DELETE')) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      searchParams.append(key, String(value));
    }
    const qs = searchParams.toString();
    url = url + (url.includes('?') ? '&' : '?') + qs;
  }

  const fetchPromise = fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method !== 'GET' && method !== 'DELETE' ? JSON.stringify(data) : undefined,
    signal: abortController.signal
  }).then(async res => {
    clearTimeout(timeoutId);
    const json = await res.json();
    return { statusCode: res.status, data: json, errMsg: 'ok' };
  }).catch(err => {
    clearTimeout(timeoutId);
    throw err;
  });

  const task: RequestTask = {
    abort: () => {
      clearTimeout(timeoutId);
      abortController.abort();
    }
  };

  task.$easyTry = () => easyTry(fetchPromise);

  return task;
}

export default BaseApi;
