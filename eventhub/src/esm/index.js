import { isValidObj, isFunction } from './validate.js'
import { safeObjectsToStrings, stringsToObject } from './objectTransformation.js'
import { EnhancedPathPrefixMatcher } from './PathPrefixMatcher.js'
import { BUILT } from './BuiltEvent.js'
import { performanceMonitor } from './performanceMonitor.js'
import { handleExecutionError, deBug } from './executionError.js'
import { createFlowController } from './flowController.js'
import { getCurrentTime, isDuplicateHandler, dellistenerHandler } from './utils.js'
// 增强型事件总线核心类
export class AdvancedEventEmitter {
  EVENTKEY = {}
  //私有属性初始化
  #listeners = new Map();         // 存储精确事件监听器（事件类型 → 处理器集合）
  #maxListeners = 200;            // 单个事件最大监听器数量
  #defaultThrottle = 150;         // 默认节流阈值（毫秒）
  #defaultDebounce = 250;         // 默认防抖阈值（毫秒）
  #pathPrefixMatcher = null;      // 节点映射
  #config = {
    enableAsyncHandling: true,    // 启用异步错误处理
    strictMode: false,           // 严格模式（开发环境建议开启）
    maxListeners: 200,          // 单个事件最大监听器数量
    defaultThrottle: 150,       // 默认节流阈值（毫秒）
    defaultDebounce: 250         // 默认防抖阈值（毫秒）
  };
  #deBug = deBug
  // 1 实例化AdvancedEventEmitter对象
  constructor(eventConfig = {}, settingConfig = {}) {
    //1.判断是否为普通对象,不是则返回 !强制eventConfig必定为普通对象
    if (!isValidObj(eventConfig)) return this.#deBug('eventConfig必定为普通对象')
    //1.3转化为路径数组
    eventConfig = safeObjectsToStrings({ eventConfig, BUILT })
    //1.4 将转化的数组返回一个绝对正确的路径对象,通过这个对象设置监听,和事件
    this.EVENTKEY = stringsToObject(eventConfig)
    //1.5 初始化事件注册表
    this.#initializeEventRegistry(eventConfig)
    //1.6配置设置
    Object.assign(this.#config, settingConfig)
    performanceMonitor.toggle(settingConfig.enabled ?? false)
  }
  // 初始化事件注册表（从配置中提取所有事件类型）
  #initializeEventRegistry(eventConfig) {
    //1.6 初始化事件注册表 eventConfig 必定為['a.b.c.d']類型的數組
    eventConfig.forEach(event => this.#listeners.set(event, new Set()))
    this.#pathPrefixMatcher ??= new EnhancedPathPrefixMatcher(Array.from(this.#listeners.keys()))
  }
  #registered(eventType, handler, config = {}) {
    //2.3 获取被注册的事件函数Set对象
    const listenerGroup = this.#listeners.get(eventType)
    //2.4 容量校验与溢出处理
    if (listenerGroup.size >= this.#maxListeners)
      return this.#deBug('事件监听器超出最大限制', 3, this.EVENTKEY.BUILT.ERROR.LISTENER_OVERFLOW, eventType)
    //2.5 重复注册检查
    if (isDuplicateHandler(listenerGroup, handler))
      return this.#deBug('重复注册相同处理器', 3, this.EVENTKEY.BUILT.ERROR.LISTENER_REPEAT, eventType)
    //2.6 应用处理器包装（节流/防抖/异步处理等）并添加对应事件处理器
    listenerGroup.add(this.#applyHandlerWrapper(eventType, handler, config))
  }
  //2 核心事件订阅方法（单事件类型和配置选项）
  onKey(eventType, handler, config = {}) {
    //2.1 验证处理器有效性
    this.#validateHandler(handler, eventType)
    //2.2 判断事件是否被注册
    this.#validateEventKey(eventType)
    this.#registered(eventType, handler, config)
    return this // 支持链式调用
  }
  //2名称空间添加监听
  onAll(eventType, handler, config = {}) {
    //2.1 验证处理器有效性
    this.#validateHandler(handler, eventType)
    //2.2 判断事件是否被注册
    this.#validateEventKey(eventType + '*')
    //2.3 获取该名称空间下,所有的注册事件key
    const eventKeys = this.#pathPrefixMatcher.getPathsByPrefix(eventType)
    //将所有的事件侦听注册
    eventKeys.forEach(v => this.#registered(v, handler, config))
    return this // 支持链式调用
  }
  //2 核心事件订阅方法（支持多事件类型和配置选项）
  on(eventType, handler, config = {}) {
    //2.1 验证处理器有效性
    this.#validateHandler(handler, eventType)
    // 验证事件类型格式
    this.#validateEventKey(eventType)
    if (this.#pathPrefixMatcher.isPathPrefix(eventType))
      return this.onAll(eventType, handler, config)
    return this.onKey(eventType, handler, config)
  }
  emit(eventType, ...payload) {
    this.#validateEventKey(eventType)// 验证事件类型格式
    performanceMonitor.startTrace(eventType) // 开始性能追踪
    // 执行处理器集合的统一方法
    const executeHandlers = handlers => {
      handlers.forEach(async handler => {
        performanceMonitor.recordInvocation(eventType) // 记录调用次数
        try {
          const start = getCurrentTime() // 记录开始时间
          await handler(...payload)            // 执行处理器
          const duration = getCurrentTime() - start // 计算耗时
          performanceMonitor.updateDuration(eventType, duration) // 更新耗时统计
        } catch (error) {
          this.#deBug(error, eventType, handler.originalRef || handler)
        }
      })
    }

    // 1. 精准匹配事件
    executeHandlers(this.#listeners.get(eventType) || new Set())
    performanceMonitor.finalizeTrace(eventType) // 结束性能追踪
    return this
  }
  off(eventType, handler) {
    if (this.#pathPrefixMatcher.isPathPrefix(eventType))
      return this.offAll(eventType, handler)
    return this.offKey(eventType, handler)
  }
  offAll(eventType, handler) {
    console.log('进来了')
    this.#validateEventKey(eventType + '*')// 验证事件类型格式
    this.#validateHandler(handler, eventType) //验证处理器有效性
    //获取该名称空间下,所有的注册事件key
    const eventKeys = this.#pathPrefixMatcher.getPathsByPrefix(eventType)
    eventKeys.forEach(v => this.#removeListener(v, handler))
    return this
  }
  //移除事件侦听
  #removeListener(eventType, handler) {
    const listenerGroup = this.#listeners.get(eventType)
    if (!listenerGroup) return
    // 遍历查找匹配的处理器 如果有则移除
    if (isFunction(handler)) dellistenerHandler(listenerGroup, handler)
    else if (handler) this.#deBug('offKey:handler非法', eventType)
    else listenerGroup = new Set()
    // 非严格模式下 自动资源回收（无监听器时删除//因为严格模式下监听都是必须使用注册的）
    if (!this.#config.strictMode && listenerGroup.size !== 0) return;
    this.#listeners.delete(currentEvent)
  }
  offKey(eventType, handler) {
    this.#validateEventKey(eventType)// 验证事件类型格式
    this.#removeListener(eventType, handler)
    return this
  }
  getEvenKey() {
    return Object.freeze(this.EVENTKEY)
  }

  //===================================核心api结束=================================================//
  //===================================非核心api开始===============================================//
  // 设置监听器上限
  setListenerLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('监听器上限必须为至少1的整数')
    }
    this.#maxListeners = limit
    return this
  }
  setDeBug(fun) {
    this.#deBug = fun
  }
  //获取性能指标
  getMetrics(eventType) {
    return performanceMonitor.getMetrics(eventType)
  }
  //===================================非核心api结束===============================================//
  //===================================验证以及处理工厂开始============================================//

  //验证处理器有效性
  #validateHandler(handler, eventType) {
    if (typeof handler === 'function') return
    this.#deBug('事件处理器必须为函数', eventType)
  }
  // 安全验证方法
  #validateEventKey(eventType) {
    //判断是否是名称空间匹配还是精确匹配
    if (eventType.endsWith('*')) return this.#validateNamespace(eventType)
    //是精确匹配
    return this.#validateEventType(eventType)
  }
  #validateEventType(eventType) {
    const isEvent = this.#listeners.has(eventType)
    //判断是否注册,注册了则直接返回
    if (isEvent) return;
    const isStrictMode = this.#config.strictMode
    //是严格模式且没有注册,报错
    if (isStrictMode) return this.#deBug(`未注册的事件: ${eventType}`)
    //非严格模式动态添加//非严格模式有动态删除
    return this.#listeners.set(eventType, new Set())
  }
  #validateNamespace(eventType) {
    // 判断是否为严格模式 不是严格模式直接返回
    if (!this.#config.strictMode) return;

    if (!this.#pathPrefixMatcher.isPathPrefix(eventType.replace('*', '')))
      return this.#deBug(`未注册的命名空间事件: ${eventType}`)
  }
  //3 处理器包装流水线
  #applyHandlerWrapper(eventType, originalHandler, config) {
    let wrappedHandler = originalHandler

    //3.1 流量控制模式（防抖/节流）
    if (config.mode) {
      //3.2获取配置时间,没有则使用默认时间
      const timing = config.timing ?? this.#getTimingConfig(config.mode)
      //创建流量控制器（防抖/节流逻辑）
      wrappedHandler = createFlowController(eventType, originalHandler, config.mode, timing)
    }
    // 异步错误处理包装
    //如果异步错误处理开启,并且函数是一个异步函数时,进行错误处理封装
    if (this.#config.enableAsyncHandling && wrappedHandler.constructor.name === 'AsyncFunction') {
      // 使用异步包装器封装原始处理器，增强错误处理能力
      wrappedHandler = this.#wrapAsyncHandler(wrappedHandler, eventType)
    }

    // 单次执行包装 则包装后直接返回
    if (config.once) {
      const tempWrapper = (...params) => {
        wrappedHandler(...params)
        //调用off,去除事件监听
        this.off(eventType, tempWrapper)
      }
      // 挂载原始方法并暴露
      tempWrapper.originalRef = originalHandler
      return tempWrapper
    }

    // 挂载原始处理器引用
    wrappedHandler.originalRef = originalHandler
    return wrappedHandler
  }
  // 获取默认时间配置
  #getTimingConfig(mode) {
    return mode === 'debounce' ? this.#defaultDebounce : this.#defaultThrottle
  }

  //4.1 异步错误处理包装器
  #wrapAsyncHandler(handler, eventType) {
    //返回一个异步处理函数
    return async (...params) => {
      try {
        await handler(...params)
      } catch (error) {
        //调用异步处理函数
        this.#deBug(error, eventType, handler)
      }
    }
  }
}

export default AdvancedEventEmitter