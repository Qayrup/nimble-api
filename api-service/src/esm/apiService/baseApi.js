
// ------------------ 核心基类
// import { globalEventBus } from '@/eventhub/index.js'  // 导入全局事件总线
import { generateCacheKey } from './cacheKeyGenerator.js'
import optimizers from './optimizers.js';
/**
 * API请求基类，提供统一的请求处理、事件派发和批量处理机制
 * @class
 * @example
 * class UserApi extends BaseApi {
 *   constructor() {
 *     super(userApiConfig, true);
 *   }
 * }
 */
class BaseApi {
  /** @static @private 事件队列缓存 */
  static EVENT_QUEUE = [];  // 静态属性：存储待处理的事件对象
  /** @static @private 批量处理定时器句柄 */
  static BATCH_TIMER = null;  // 静态属性：批量事件处理的微任务标记
  
  /**
   * 创建API实例
   * @param {Object} apiConfig - API配置字典（必须包含对应apiKey的配置）
   * @param {boolean} [enableLogging=false] - 是否启用请求日志
   */
  constructor(apiConfig,settings) {
    this.apiConfig = apiConfig  // 存储API配置
    this.enableLogging = settings.enableLogging??false  // 日志开关,默认关
    this.cache = new Map()  // 创建缓存Map（key-value存储）
    this.cacheTimers = new Map()  // 存储缓存定时器（用于自动清除）
    this.requestTasks = new Map()  // 存储进行中的请求任务（用于取消）
    this.requestCounter = new Map()  // 请求计数器（当前未使用）
    // 优化配置存储
    this.optimizationConfig = new Map();
    //全局锁
    this.switchLockMap = new Map();
    // 防抖缓存
    this.debounceCache = new Map(); 
    // 添加节流缓存
    this.throttleCache = new Map(); 
  }
  //---------------------------------------------------------------------------------------------------------------------------------------------------
  /**
   * 设置优化配置
   * @param {string} type - 优化类型 (debounce, throttle, switch, return)
   * @param {...any} args - 优化参数
   * @returns {Object} 代理对象
   */
  optimize(type, ...args) {
    // 创建优化配置对象
    const optimization = { type, args };
    // 返回代理对象，支持链式调用
    const proxy = new Proxy(this, {
      get: (target, prop) => {
        // 支持链式调用optimize
        if (prop === 'optimize') {
          return (newType, ...newArgs) => 
            proxy.optimize(newType, ...newArgs);
        }
        
        // 处理API方法调用
        if (prop.endsWith('API')) {
          const originalMethod = target.getAPIMethod(prop);
          
          // 应用优化配置
          return this.applyOptimization(originalMethod, optimization);
        }
        
        return Reflect.get(target, prop);
      }
    });
    
    return proxy;
  }
   /**
   * 应用优化到方法
   * @private
   * @param {Function} method - 原始API方法
   * @param {Object} optimization - 优化配置
   * @returns {Function} 优化后的方法
   */
  applyOptimization(method, optimization) {
    switch (optimization.type) {
      case 'debounce':
        return optimizers.debounceOptimizer(
          method, 
          this.debounceCache, 
          ...optimization.args
        );
      case 'throttle':
        return optimizers.throttleOptimizer(
          method, 
          this.throttleCache, 
          ...optimization.args
        );
      case 'switchLock':
        return optimizers.switchLockOptimizer(
          method, 
          this.switchLockMap, 
          ...optimization.args
        );
      case 'linkLock':
        return optimizers.linkLockOptimizer(
          method, 
          ...optimization.args
        );
      case 'return':
        return optimizers.returnControlOptimizer(
          method, 
          ...optimization.args
        );
      case 'debounceThrottle':
        return optimizers.debounceThrottleOptimizer(
          method, 
          this.debounceCache, 
          this.throttleCache, 
          ...optimization.args
        );
      default:
        return method;
    }
  }
   //---------------------------------------------------------------------------------------------------------------------------------------------------
  /**
   * 执行API请求（核心请求方法）
   * @async
   * @param {string} apiKey - API配置标识符
   * @param {Object} params - URL参数（用于路径构建）
   * @param {Object} data - 请求体数据
   * @param {Function} urlBuilder - 预编译的URL生成函数
   * @returns {Promise<Object>} 请求结果（自动处理响应）
   * @throws {Error} 当apiKey不存在或网络错误时抛出
   * @example
   * await api.makeRequest('login', { id: 123 }, { password: '***' }, buildUrl);
   */
  async makeRequest(apiKey, params, data, urlBuilder) {
    // 获取对应API配置
    const config = this.apiConfig[apiKey]
    // 配置不存在时抛出错误
    if (!config) throw new Error(`Unknown API key: ${apiKey}`)
    // 生成缓存键（API标识+参数字符串）
    // const cacheKey = `${apiKey}:${JSON.stringify(params)}:${JSON.stringify(data)}`
    //深度优化缓存键（API标识+params+data）
    const cacheKey = generateCacheKey(apiKey,params,data)
    // 检查缓存是否存在且有效
    if (config.cacheTTL && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)  // 直接返回缓存结果
    }

    // 取消同类型的前序请求（防重复）
    const prevTask = this.requestTasks.get(apiKey)
    if (prevTask && prevTask.abort instanceof Function) {
      prevTask.abort()  // 执行取消操作
      this.requestTasks.delete(apiKey)  // 移除任务记录
    }

    try {
      // 构建完整URL
      const url = urlBuilder(params)
      // 基础请求配置
      const baseConfig = {
        url,
        method: config.method || 'GET',  // 默认GET方法
        header: {
          'Content-Type': 'application/json',  // 默认JSON类型
          ...(config.headers || {})  // 合并自定义头
        }
      }

      let response, task
      // 特殊处理文件上传
      if (config.method === 'UPLOAD') {
        task = uni.uploadFile({
          ...baseConfig,
          filePath: data.file,  // 文件路径
          name: 'file'  // 表单字段名
        })
        this.requestTasks.set(apiKey, task)  // 存储上传任务
        response = await task.$easyTry()  // 执行并等待结果（带错误处理）
      } else { // 处理普通请求
        const requestConfig = Object.assign(
          baseConfig,
          // 根据请求方法决定参数位置
          ['GET', 'DELETE'].includes(config.method) 
            ? { params: data }   // GET/DELETE使用查询参数
            : { data }            // 其他方法使用请求体
        )
        // task = uni.request(requestConfig)  // 创建请求任务
        task = new Promise(res => {
          setTimeout(() => {
            res({
      statusCode: 200,
      data: { code: 0, message: "模拟成功数据" },
      errMsg: "request:ok"
    })
          }, 5000);
        })
        this.requestTasks.set(apiKey, task)  // 存储请求任务
        response = await task.$easyTry()  // 执行并等待结果
      }

      // 解构响应结果 [错误对象, 响应对象]
      const [rej, res] = response
      // 处理响应（包括事件触发）
      const result = this.handleResponse(apiKey, rej, res)

      // 成功响应且配置了缓存时设置缓存
      if (config.cacheTTL && !rej && res.code === 200) {
        this.setCache(cacheKey, result, config.cacheTTL)
      }

      return result
    } catch (error) {
      this.clearCache(cacheKey)  // 出错时清除可能存在的缓存
      throw error  // 重新抛出错误
    } finally {
      this.requestTasks.delete(apiKey)  // 无论成功失败都移除任务记录
    }
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {number} ttl - 缓存有效期(毫秒)
   */
  setCache(key, value, ttl) {
    this.cache.set(key, value)  // 存入缓存
    // 设置定时自动清除
    this.cacheTimers.set(
      key,
      setTimeout(() => {
        this.cache.delete(key)
        this.cacheTimers.delete(key)
      }, ttl)
    )
  }

  /**
   * 清除指定缓存
   * @param {string} key - 缓存键
   */
  clearCache(key) {
    clearTimeout(this.cacheTimers.get(key))  // 清除定时器
    this.cache.delete(key)  // 移除缓存项
    this.cacheTimers.delete(key)  // 移除定时器记录
  }

  /**
   * 处理响应并触发事件
   * @private
   * @param {string} apiKey - API标识
   * @param {?Object} rej - 错误对象
   * @param {?Object} res - 响应对象
   * @returns {Object} 处理后的响应数据
   */
  handleResponse(apiKey, rej, res) {
    const config = this.apiConfig[apiKey]
    const result = rej || res  // 最终结果（错误优先）
    const isSuccess = !rej && res.code === 200  // 判断是否成功

    if (isSuccess) {
      // 处理成功事件（支持多事件配置）
      const successEvents = Array.isArray(config.eventSuccess)
        ? config.eventSuccess
        : [config.eventSuccess]
      
      successEvents.forEach((sEvent) => {
        if (sEvent) {
          BaseApi.queueEvent({
            successEvent: sEvent,
            errorEvent: null,
            payload: result,  // 传递响应结果
            isSuccess: true
          })
        }
      })
    } else {
      // 处理错误事件（根据状态码获取对应事件）
      const errorEvent = this.getErrorEvent(config, rej ? rej.code : res.code)
      // 支持多事件配置
      const errorEvents = Array.isArray(errorEvent) ? errorEvent : [errorEvent]
      
      errorEvents.forEach((eEvent) => {
        if (eEvent) {
          BaseApi.queueEvent({
            successEvent: null,
            errorEvent: eEvent,
            payload: result,  // 传递错误信息
            isSuccess: false
          })
        }
      })
    }
    
    return result  // 返回原始响应数据
  }

  /**
   * 获取错误事件类型
   * @private
   * @param {Object} config - API配置
   * @param {number} [code] - 错误状态码
   * @returns {string|null} 对应的事件类型
   */
  getErrorEvent(config, code) {
    // 优先匹配特定状态码事件，未匹配时使用默认事件
    return config.eventErrors?.[code] || config.eventErrors?.default
  }

  /**
   * 将事件加入队列（微任务批量处理）
   * @static
   * @private
   * @param {Object} event - 事件对象
   */
  static queueEvent(event) {
    this.EVENT_QUEUE.push(event)  // 加入队列
    
    // 首次添加时启动微任务批量处理
    if (!this.BATCH_TIMER) {
      this.BATCH_TIMER = Promise.resolve().then(() => {
        this.flushEvents()  // 执行批量处理
        this.BATCH_TIMER = null  // 重置标记
      })
    }
  }

  /**
   * 批量派发队列中的事件
   * @static
   * @private
   * @emits 通过globalEventBus触发事件
   */
  static flushEvents() {
    // 复制当前队列并清空原始队列
    const events = this.EVENT_QUEUE.splice(0)
    const eventMap = new Map()  // 创建事件分组Map

    // 事件分组（合并同类事件）
    events.forEach(({ successEvent, errorEvent, payload, isSuccess }) => {
      const eventKey = isSuccess ? successEvent : errorEvent
      if (!eventKey) return  // 跳过无效事件
      
      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, [])  // 初始化事件数组
      }
      eventMap.get(eventKey).push(payload)  // 将负载加入对应事件数组
    })

    // 批量派发合并后的事件
    eventMap.forEach((payloads, eventKey) => {
      // 单个事件直接派发，多个事件以数组形式派发
      const payload = payloads.length > 1 ? payloads : payloads[0]
      // globalEventBus.emit(eventKey, payload)  // 触发全局事件
    })
  }
}

export { BaseApi }  // 导出BaseApi类