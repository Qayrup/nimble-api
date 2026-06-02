import { BaseApi } from './baseApi';
import type { ApiConfig, ApiSettings, ApiMethodObj, ApiMethodWithOptimize } from './baseApi';

/**
 * API服务类，继承基础API实现动态方法生成
 */
export class ApiService extends BaseApi {
  private static MAX_API_CACHE = 200;

  /** URL构建器缓存 */
  urlBuilderCache = new Map<string, ApiMethodObj>();
  /** LINKAPI Proxy 缓存，避免每次属性访问重复创建 */
  linkProxyCache = new Map<string, ApiMethodWithOptimize>();

  constructor(config: ApiConfig, settings: ApiSettings = {}) {
    super(config, settings);
  }

  precompileMethods(): void {
    Object.keys(this.apiConfig).forEach(apiKey => {
      if (Object.prototype.hasOwnProperty.call(this, apiKey))
        throw new Error(`ApiService代理键重复,重复键:${apiKey}`);
      (this as Record<string, unknown>)[apiKey] = this._createCompiledMethod(apiKey);
    });
  }

  _validateConfiguration(configObj: ApiConfig[string], apiKey: string): void {
    if (!configObj) throw new Error(`${apiKey}:没有这个api`);
    if (!configObj.url) throw new Error(`${apiKey}:url无效`);
    if (!Array.isArray(configObj.eventSuccess) || configObj.eventSuccess.length < 1)
      throw new Error(`${apiKey}:eventSuccess 无效`);
    if (!configObj.eventErrors || !configObj.eventErrors.default)
      throw new Error(`${apiKey}:eventErrors 无效`);
  }

  /**
   * 动态编译生成API请求方法（核心方法）
   */
  _createCompiledMethod<T = unknown>(apiKey: string): ApiMethodObj<T> {
    // 检查缓存
    if (this.urlBuilderCache.has(apiKey))
      return this.urlBuilderCache.get(apiKey)! as ApiMethodObj<T>;

    // 获取API配置
    const configObj = this.apiConfig[apiKey];
    this._validateConfiguration(configObj, apiKey);

    // 创建URL构建器函数（单次 replace 避免多次循环产生中间字符串）
    const urlBuilder = (params: Record<string, string | number>): string =>
      configObj.url.replace(/{([^}]+)}/g, (_match, key) => {
        const value = params[key];
        if (value === void 0)
          throw new Error(`${configObj.url}缺少必要参数: ${key}`);
        return encodeURIComponent(String(value));
      });

    // 创建API方法（使用通用签名匹配 MethodWithMethodId）
    const method: ApiMethodObj<T> = (...args: unknown[]) =>
      this.makeRequest<T>(apiKey, (args[0] as Record<string, string | number>) || {}, (args[1] as Record<string, unknown>) || {}, urlBuilder);

    // 为方法添加唯一标识符
    method.methodId = Symbol(`API_METHOD_${apiKey}`);

    // 缓存方法
    if (this.urlBuilderCache.size >= ApiService.MAX_API_CACHE) {
      const firstKey = this.urlBuilderCache.keys().next().value as string;
      this.urlBuilderCache.delete(firstKey);
    }
    this.urlBuilderCache.set(apiKey, method as ApiMethodObj);
    return method;
  }

  /**
   * 获取或创建API方法（缓存机制，支持 optimize 链式调用）
   */
  getAPIMethodLink<T = unknown>(apiKey: string): ApiMethodWithOptimize<T> {
    if (this.linkProxyCache.has(apiKey)) {
      return this.linkProxyCache.get(apiKey)! as ApiMethodWithOptimize<T>;
    }

    if (!(apiKey in this)) {
      (this as Record<string, unknown>)[apiKey] = this._createCompiledMethod(apiKey);
    }
    const method = (this as Record<string, unknown>)[apiKey] as ApiMethodObj<T>;

    const linkProxy = new Proxy(method, {
      apply: (_target, thisArg, args) => method.apply(thisArg, args),
      get: (_target, prop) => {
        if (prop === 'optimize') {
          return (type: string, ...params: unknown[]) => {
            const optimizedMethod = this.applyOptimization(method, {
              type,
              args: params
            });
            return optimizedMethod;
          };
        }
        return Reflect.get(_target, prop);
      }
    }) as unknown as ApiMethodWithOptimize<T>;

    if (this.linkProxyCache.size >= ApiService.MAX_API_CACHE) {
      const firstKey = this.linkProxyCache.keys().next().value as string;
      this.linkProxyCache.delete(firstKey);
    }
    this.linkProxyCache.set(apiKey, linkProxy as ApiMethodWithOptimize);
    return linkProxy;
  }

  getAPIMethod<T = unknown>(apiKey: string): ApiMethodObj<T> {
    if (!(apiKey in this)) {
      (this as Record<string, unknown>)[apiKey] = this._createCompiledMethod(apiKey);
    }
    return (this as Record<string, unknown>)[apiKey] as ApiMethodObj<T>;
  }
}

// 代理处理器：渐进式加载 — 首次访问时编译方法并存入实例，
// 后续访问直接读取实例自身属性，避免每次经过 getAPIMethod
export const apiProxyHandler: ProxyHandler<ApiService> = {
  get(target, prop, _receiver) {
    if (typeof prop === 'string') {
      // 快速路径：已自缓存的属性直接返回，跳过字符串匹配
      if (prop in target) {
        return (target as unknown as Record<string, unknown>)[prop];
      }
      if (prop.endsWith('API')) {
        const apiKey = prop.slice(0, -3);
        if (apiKey in target) {
          const method = (target as unknown as Record<string, unknown>)[apiKey];
          (target as unknown as Record<string, unknown>)[prop] = method;
          return method;
        }
        return target.getAPIMethod(apiKey);
      }
      if (prop.endsWith('LINKAPI')) {
        const apiKey = prop.slice(0, -7);
        const linkMethod = target.getAPIMethodLink(apiKey);
        (target as unknown as Record<string, unknown>)[prop] = linkMethod;
        return linkMethod;
      }
    }
    return Reflect.get(target, prop, _receiver);
  }
};
