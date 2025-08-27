// 统一错误处理管道
// handleExecutionError 被调用时会传入一个error错误对象 event 事件名称/标识/行为  handler 调用的函数 
export function handleExecutionError(error, event, handler) {
  // === 1. 收集运行时环境信息 ===
  // 获取跨平台系统信息（兼容非UniApp环境）
  const systemInfo = uni.getSystemInfoSync?.() || {} // 使用可选链避免非UniApp环境报错
  const platform = systemInfo.platform?.toLowerCase() || 'unknown' // 标准化平台标识

  // === 2. 返回构建结构化错误元数据 ===
  return {
    event,          // 事件类型（如'click','network_error'）
    handler: handler.toString(), // 存储处理器源码（便于定位问题函数）
    error: error.stack || error.toString(), // 优先记录调用栈，次选基础错误信息
    timestamp: new Date().toISOString(), // ISO8601标准时间戳
    environment: {   // 环境上下文信息（关键调试依据）
      platform: mapPlatform(platform), // 映射为统一平台标识（如：weapp->weixin）
      deviceModel: systemInfo.model || 'Unknown', // 设备型号（iOS/Android/小程序宿主）
      osVersion: systemInfo.system || 'Unknown',  // 操作系统版本
      userAgent: typeof navigator !== 'undefined'
        ? navigator.userAgent  // 浏览器环境UA
        : `UniApp/${systemInfo.platform || 'unknown'} v${systemInfo.version || ''}` // 非浏览器环境构造UA
    }
  }
}
// 平台名称映射（统一多端平台标识）
function mapPlatform(rawPlatform) {
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

export function deBug(msg, eventType, handler) {
  const log = `${msg}::eventType:${eventType}::Date:${new Date()}`
  throw new Error(log);
}