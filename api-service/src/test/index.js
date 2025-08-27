import '../esm/promiseAdditional.js'
import { ApiService, apiProxyHandler } from '../esm/apiService/apiService.js'
const configAAA = {
  phoneLogin: {
    url: '/system/login/phone/{tel}/{phoneCaptcha}',
    eventSuccess: ["EVENT_CONFIG.BUSINESS.USER.LOGIN_OK",
      "EVENT_CONFIG.BUSINESS.SESSION.FLUSHED_TOKEN_OK"
    ],
    eventErrors: {
      default: "EVENT_CONFIG.BUSINESS.USER.LOGINERR_ERR",
    },
  },
}
// 单例实例
let singletonInstance = {};

// 工厂函数：创建新实例
export function createApiService(apiConfig = {}, settings = {}) {
  return new Proxy(new ApiService(apiConfig, settings), apiProxyHandler)
}

// 单例初始化
export function initApiService(userConfig = {}, settings = {}) {
  if (Object.keys(singletonInstance).length !== 0)
    return singletonInstance;
  singletonInstance = createApiService(userConfig, settings);
  return singletonInstance;
}

// 获取单例
export function getApiService() {
  if (!singletonInstance) {
    throw new Error('请先调用 initApiService 初始化API服务');
  }
  return singletonInstance;
}
// 导出优化器类型常量
export const OPTIMIZE_TYPES = {
  DEBOUNCE: 'debounce',
  THROTTLE: 'throttle',
  SWITCH_LOCK: 'switchLock',
  LINK_LOCK: 'linkLock',
  RETURN_CONTROL: 'return',
  DEBOUNCE_THROTTLE: 'debounceThrottle'
};
const proxyHandler = {
  get(_, prop) {
    return Reflect.get(singletonInstance, prop);
  },
  set: () => {
    throw new Error('ApiService is read-only. Modifications blocked.');
  },
  deleteProperty: () => {
    throw new Error('ApiService is read-only. Deletions blocked.');
  }
}
const apiService = new Proxy({}, proxyHandler)
export default apiService






//------------------------------------------------------------测试代码------------------------------------------------------------------------------------------
initApiService(configAAA)
console.log(apiService)
const obj = { value: false }
const proxyObj = new Proxy(obj, {
  set(target, prop, value) {
    const aaa = Reflect.set(target, prop, value)
    console.log('-----------设置了-------', value)
    return aaa
  },
  get(target, prop) {
    console.log('访问了:', target[prop])
    return target[prop]
  }
})
// console.log(proxyObj)
// console.log(proxyObj.value)
// proxyObj.value = true
// proxyObj.value=false
// console.log(proxyObj)
console.log('-----------------------------------验证自定义proxyObj switch开始-------------------------------------------')
async function aaa() {
  const aaa = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa2 = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa3 = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  console.log(await apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }))
  console.log('-----------------------------------开始-------------------------------------------')
  aaa.then(res => {
    console.log('aaa', res, proxyObj.value)
  })
  aaa2.then(res => {
    console.log('aaa1', res, proxyObj.value)
  })
  aaa3.then(res => {
    console.log('aaa2', res, proxyObj.value)
  })
}
aaa()
await console.log('-----------------------------------验证自定义proxyObj switch结束-------------------------------------------')

console.log('-----------------------------------验证自维护锁 switch开始-------------------------------------------')
async function aaa1() {
  const aaa1 = apiService.optimize('switchLock')
    .phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa2 = apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa3 = apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  console.log(await apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }))
  console.log('-----------------------------------开始-------------------------------------------')
  aaa1.then(res => {
    console.log('aaa1', res)
  })
  aaa2.then(res => {
    console.log('aaa2', res)
  })
  aaa3.then(res => {
    console.log('aaa3', res)
  })
}
await aaa1()
console.log('-----------------------------------验证自维护锁 switch结束-------------------------------------------')




console.log('-----------------------------------验证防抖 debounce开始-------------------------------------------')
async function aaa2() {
  const aaa1 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa2 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  const aaa3 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 })
  console.log(await apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }))
  console.log('-----------------------------------开始-------------------------------------------')
  aaa1.then(res => {
    console.log('aaa1', res)
  })
  aaa2.then(res => {
    console.log('aaa2', res)
  })
  aaa3.then(res => {
    console.log('aaa3', res)
  })
}
await aaa2()
console.log('-----------------------------------验证防抖 debounce结束-------------------------------------------')

