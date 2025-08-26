import { isValidObj, isFunction } from './esm/validate.js'
import { safeObjectsToStrings, stringsToObject } from './esm/utils.js'
import { EnhancedPathPrefixMatcher } from './esm/PathPrefixMatcher.js'
import { getCurrentTime } from './esm/utils.js'
import { BUILT } from './esm/BuiltEvent.js'
import { performanceMonitor } from './esm/performanceMonitor.js'

// 增强型事件总线核心类
export class AdvancedEventEmitter {
  #EVENTKEY = {}
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
  #deBug = (str, level = 1, eventType, eventMsg) => {
    switch (level) {
      case 1:
        console.log(str)
        break;
      case 3:
        this.#notifyError(eventType, eventMsg)
        // throw new Error(`事件监听器超出最大限制: ${eventMsg}`)
        console.log()
      default:
        console.log(eventType, eventMsg)
        break;
    }
    return false
  }
  // 1 实例化AdvancedEventEmitter对象
  constructor(eventConfig = {}, settingConfig = {}) {
    //1.判断是否为普通对象,不是则返回 !强制eventConfig必定为普通对象
    if (!isValidObj(eventConfig)) return this.#deBug('eventConfig必定为普通对象', 3)
    //1.3转化为路径数组
    eventConfig = safeObjectsToStrings({ eventConfig, BUILT })
    //1.4 将转化的数组返回一个绝对正确的路径对象,通过这个对象设置监听,和事件
    this.#EVENTKEY = stringsToObject(eventConfig)
    console.log(eventConfig, this.#EVENTKEY)
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
      return this.#deBug('事件监听器超出最大限制', 3, this.#EVENTKEY.BUILT.ERROR.LISTENER_OVERFLOW, eventType)
    //2.5 重复注册检查
    if (this.#isDuplicateHandler(listenerGroup, handler))
      return this.#deBug('重复注册相同处理器', 3, this.#EVENTKEY.BUILT.ERROR.LISTENER_REPEAT, eventType)
    //2.6 应用处理器包装（节流/防抖/异步处理等）并添加对应事件处理器
    listenerGroup.add(this.#applyHandlerWrapper(eventType, handler, config))
  }
  //2 核心事件订阅方法（单事件类型和配置选项）
  onKey(eventType, handler, config = {}) {
    //2.1 验证处理器有效性
    this.#validateHandler(handler)
    //2.2 判断事件是否被注册
    this.#validateEventKey(eventType)
    this.#registered(eventType, handler, config)
    return this // 支持链式调用
  }
  //2名称空间添加监听
  onAll(eventType, handler, config = {}) {
    //2.1 验证处理器有效性
    this.#validateHandler(handler)
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
    this.#validateHandler(handler)
    // 验证事件类型格式
    this.#validateEventKey(eventType)
    if (this.#pathPrefixMatcher.isPathPrefix(eventType))
      return this.onAll(eventType, handler, config = {})
    return this.onKey(eventType, handler, config = {})
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
          this.#handleExecutionError(error, eventType, handler.originalRef || handler)
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
    this.#validateHandler(handler) //验证处理器有效性
    //获取该名称空间下,所有的注册事件key
    const eventKeys = this.#pathPrefixMatcher.getPathsByPrefix(eventType)
    eventKeys.forEach(v => this.#removeListener(v, handler))
    return this
  }
  //移除事件侦听
  #removeListener(eventType, handler) {
    const listenerGroup = this.#listeners.get(eventType)
    if (!listenerGroup) return
    if (isFunction(handler))
      this.#dellistenerHandler(listenerGroup, handler)// 遍历查找匹配的处理器
    else if (handler) this.#deBug('offKey:handler非法', 3, this.#EVENTKEY.BUILT.ERROR.HANDLER_ILLEGAL, eventType)
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
    return Object.freeze(this.#EVENTKEY)
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
  #dellistenerHandler(listenerGroup, handler) {
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
  //验证处理器有效性
  #validateHandler(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('事件处理器必须为函数')
    }
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
  //默认错误处理器
  #notifyError(errorCode, event) {
    this.emit(this.#EVENTKEY.BUILT.ERROR.DEFAULT, {
      code: errorCode,
      event,
      maxLimit: this.#maxListeners,
      timestamp: new Date().toISOString()
    })
  }
  // 检查重复处理器
  #isDuplicateHandler(listenerGroup, handler) {
    return Array.from(listenerGroup).some(
      wrapper => wrapper.originalRef === handler
    )
  }
  //3 处理器包装流水线
  #applyHandlerWrapper(eventType, originalHandler, config) {
    let wrappedHandler = originalHandler

    //3.1 流量控制模式（防抖/节流）
    if (config.mode) {
      //3.2获取配置时间,没有则使用默认时间
      const timing = config.timing ?? this.#getTimingConfig(config.mode)
      //创建流量控制器（防抖/节流逻辑）
      wrappedHandler = this.#createFlowController(eventType, originalHandler, config.mode, timing)
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
  // 3.2.1创建流量控制器（防抖/节流逻辑）
  #createFlowController(eventType, handler, mode, delay) {
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
  //4.1 异步错误处理包装器
  #wrapAsyncHandler(handler, eventType) {
    //返回一个异步处理函数
    return async (...params) => {
      try {
        await handler(...params)
      } catch (error) {
        //调用异步处理函数
        this.#handleExecutionError(error, eventType, handler)
      }
    }
  }
  // 统一错误处理管道（核心错误拦截与上报方法）
  #handleExecutionError(error, event, handler) {
    // === 1. 收集运行时环境信息 ===
    // 获取跨平台系统信息（兼容非UniApp环境）
    const systemInfo = uni.getSystemInfoSync?.() || {} // 使用可选链避免非UniApp环境报错
    const platform = systemInfo.platform?.toLowerCase() || 'unknown' // 标准化平台标识

    // === 2. 构建结构化错误元数据 ===
    const errorData = {
      event,          // 事件类型（如'click','network_error'）
      handler: handler.toString(), // 存储处理器源码（便于定位问题函数）
      error: error.stack || error.toString(), // 优先记录调用栈，次选基础错误信息
      timestamp: new Date().toISOString(), // ISO8601标准时间戳
      environment: {   // 环境上下文信息（关键调试依据）
        platform: this.#mapPlatform(platform), // 映射为统一平台标识（如：weapp->weixin）
        deviceModel: systemInfo.model || 'Unknown', // 设备型号（iOS/Android/小程序宿主）
        osVersion: systemInfo.system || 'Unknown',  // 操作系统版本
        userAgent: typeof navigator !== 'undefined'
          ? navigator.userAgent  // 浏览器环境UA
          : `UniApp/${systemInfo.platform || 'unknown'} v${systemInfo.version || ''}` // 非浏览器环境构造UA
      }
    }

    // === 3. 错误分发逻辑 ===
    const errorHandlers = this.#listeners.get(EVENT_CONFIG.SYSTEM.ERROR) // 获取注册的错误监听器集合
    if (errorHandlers?.size > 0) {
      // 存在监听器：触发所有错误处理回调（事件总线模式)
      errorHandlers.forEach(h => h(errorData))
    } else {
      // 无监听器：降级处理
      console.error(`未处理的异常事件『${event}』`, errorData) // 控制台输出详细日志

      // 严格模式处理：重新抛出错误（中断程序，避免静默失败）[8](@ref)
      if (this.#config.strictMode) {
        throw error // 适用于开发环境快速定位问题
      }
    }
  }
  // 平台名称映射（统一多端平台标识）
  #mapPlatform(rawPlatform) {
    const platformMap = {
      'ios': 'iOS',
      'android': 'Android',
      'windows': 'Windows',
      'mac': 'MacOS',
      'devtools': 'Browser',
      'mp-weixin': 'WeChatMP'
    }
    return platformMap[rawPlatform] || rawPlatform
  }
}

export default AdvancedEventEmitter