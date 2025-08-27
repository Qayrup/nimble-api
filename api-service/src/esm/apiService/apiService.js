/**
 * 核心API服务模块，提供动态接口配置与请求能力
 * @module ApiService
 */

// 导入基础API模块及配置
import { BaseApi } from './baseApi.js'

/**
 * API服务类，继承基础API实现动态方法生成
 * @class ApiService
 * @extends BaseApi
 */
export class ApiService extends BaseApi {
  /**
   * 初始化API配置
   * @constructs ApiService
   */
  constructor(config,settings={}) {
    // if (!Array.isArray(config))
    //   throw new TypeError(`ApiService config 必须为数组，实际类型: ${typeof config}`);
    super(config,settings)
    //定义一个根据url编译缓存方法
    this.urlBuilderCache = new Map()
    // 初始化API方法
    // this.precompileMethods()
  }
  precompileMethods () {
		//循环遍历apiConfig配置
    Object.keys(this.apiConfig).forEach(apiKey => {
			//判断ApiService对象有无这个API key 
      if (this[apiKey]) 
			 throw new Error(`ApiService代理键重复,重复键:${apiKey}`)
			//如果没有就添加这个key,以及对应的API方法
      this[apiKey] = this._createCompiledMethod(apiKey)
    })
  }
  _validateConfiguration(configObj, apiKey) {
    if(!configObj)throw new Error(`${apiKey}:没有这个api`)
    if (!configObj.url) throw new Error(`${apiKey}:url无效`)
    if (!Array.isArray(configObj.eventSuccess) || configObj.eventSuccess.lenght < 1)
      throw new Error(`${apiKey}:eventSuccess 无效`)
    if (!configObj.eventErrors||!configObj.eventErrors.default)
      throw new Error(`${apiKey}:eventErrors 无效`)
    return true 
  }
  /**
   * 动态编译生成API请求方法（核心方法）
   * @param {string} apiKey - API配置标识符
   * @returns {Function} 预配置的请求函数
   * @throws {Error} 当配置不存在时抛出异常[7](@ref)
   */
_createCompiledMethod(apiKey) {
  // 1. 检查缓存：如果该apiKey的方法已编译过，直接从缓存返回
  if (this.urlBuilderCache.has(apiKey)) 
    return this.urlBuilderCache.get(apiKey);
  // 2. 获取API配置：从apiConfig对象中取出该apiKey对应的配置
  const configObj = this.apiConfig[apiKey];
  if(!this._validateConfiguration(configObj,apiKey))return 
  // 3. 定义正则表达式：匹配花括号内的内容（如{userId}）
  const regex = /{([^}]+)}/g;
  // 4. 获取所有匹配项：使用matchAll获取所有占位符的匹配结果
  //    matchAll返回的是迭代器，Array.from将其转为数组
  //    例如：对于"/users/{id}" => 得到 [['{id}', 'id']]
  const matches = Array.from(configObj.url.matchAll(regex));
  // 5. 提取参数键名：将匹配结果映射为参数名数组
  //    例如：[['{id}', 'id']] => ['id']
  const paramKeys = matches.map(match => match[1]);
  // 6. 创建URL构建器函数：将URL模板中的占位符替换为实际参数值
  const urlBuilder = params => {
    // 6.1 从配置的URL模板开始
    let builtUrl = configObj.url;
    // 6.2 遍历所有参数键（如['userId', 'orderId']）
    for (const key of paramKeys) {
      // 6.3 替换每个占位符为实际参数值
      //     注意：如果params中缺少该key，会替换为"undefined"
			const currentParams=params[key]
			if(currentParams === void 0) 
				throw new Error(`${builtUrl}缺少必要参数: ${key}`)
      builtUrl = builtUrl.replace(`{${key}}`, currentParams)
    }
    // 6.4 返回构建好的URL
    return builtUrl;
  };
  
  // 7. 创建API方法：封装实际请求调用
  const method = (params = {}, data = {}) =>
    // 7.1 调用makeRequest执行实际请求
    //     参数：apiKey, 路径参数, 请求体数据, URL构建器
    this.makeRequest(apiKey, params, data, urlBuilder)
    // 为方法添加唯一标识符  后续需要使用!!!!md
    method.methodId = Symbol(`API_METHOD_${apiKey}`);
    // 8. 缓存方法：将编译好的方法存入缓存
    this.urlBuilderCache.set(apiKey, method);
    // 9. 返回新创建的方法
    return method;
  }

  /**
   * 获取或创建API方法（缓存机制）
   * @param {string} apiKey - API配置标识符
   * @returns {Function} 已生成的API方法
   */
  getAPIMethodLink(apiKey) {
    // 如果还没有为这个apiKey创建方法，则创建并缓存
    if (!this[apiKey]) {
      this[apiKey] = this._createCompiledMethod(apiKey);
    }
    const method = this[apiKey];
    // 返回一个代理，支持直接调用或继续优化
    return new Proxy(method, {
      apply: (target, thisArg, args) => target.apply(thisArg, args),
      get: (target, prop) => {
        if (prop === 'optimize') {
          return (type, ...params) => {
            const optimizedMethod = this.applyOptimization(target, { 
              type, 
              args: params 
            });
            return optimizedMethod;
          };
        }
        return Reflect.get(target, prop);
      }
    });
  }
  getAPIMethod(apiKey) {
    // 确保方法名以API结尾
    const methodName = apiKey.endsWith('API') ? apiKey : `${apiKey}API`;
    
    // 如果还没有这个方法，则创建
    if (!this[methodName]) {
      this[methodName] = this._createCompiledMethod(
        methodName.replace('API', '')
      );
    }
    return this[methodName];
  }

}


// 代理处理器/让api惰性加载
export const apiProxyHandler = {
  //拦截get请求
  get(target, prop) {
    //判断访问的key是不是以指定后缀结尾,是则去除后最
    if (prop.endsWith('API'))
      return target.getAPIMethod(prop.slice(0, -3))
    else if (prop.endsWith('LINKAPI'))
      return target.getAPIMethod(prop.slice(0, -7))
     return Reflect.get(target, prop);
  }
}

// export default new Proxy(new ApiService(apiConfig), apiProxyHandler)