/**
 * 缓存键
 * @param {string} apiKey - API标识符
 * @param {Object} params - 路径参数对象
 * @param {Object} data - 请求体数据
 * @param {Object} [options] - 配置选项
 * @param {number} [options.hashLength=32] - 哈希长度 32 / 64
 * @param {boolean} [options.isNormalizeObject=false] - 范化对象属性顺序
 * @returns {string} 缓存键
 */
export function generateCacheKey(apiKey, params, data, options = {}) {
  // 设置默认选项
  const { 
    hashLength = 32, 
    isNormalizeObject = false 
  } = options;
  
  // 处理对象规范化
  const normalizedParams = isNormalizeObject ? 
    normalizeObject(params) : 
    stableNormalize(params);
  
  const normalizedData = isNormalizeObject ? 
    normalizeObject(data) : 
    stableNormalize(data);
  
  // 生成稳定字符串表示
  const paramsString = stableStringify(normalizedParams);
  const dataString = stableStringify(normalizedData);
  
  // 使用高效哈希算法处理长字符串
  const paramsHash = hashString(paramsString, hashLength);
  const dataHash = hashString(dataString, hashLength);
  
  return `${apiKey}:${paramsHash}:${dataHash}`;
}

/**
 * 仅排序属性，不处理特殊值
 * @param {any} obj - 输入对象
 * @returns {any} 规范化后的对象
 */
export function stableNormalize(obj) {
  // 基本类型直接返回
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // 处理数组 - 递归处理每个元素
  if (Array.isArray(obj)) {
    return obj.map(stableNormalize);
  }
  
  // 处理普通对象 - 排序属性
  const sortedObj = {};
  Object.keys(obj)
    .sort()
    .forEach(key => {
      sortedObj[key] = stableNormalize(obj[key]);
    });
  
  return sortedObj;
}

/**
 * 深度规范化对象 - 处理特殊值并确保属性顺序一致
 * @param {any} obj - 输入对象
 * @param {WeakSet} [seen] - 已处理对象集合
 * @returns {any} 规范化后的对象
 */
export function normalizeObject(obj, seen = new WeakSet()) {
  // 基本类型直接返回
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // 检测循环引用
  if (seen.has(obj)) {
    return '__CIRCULAR_REF__';
  }
  seen.add(obj);
  
  // 处理Date对象
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  // 处理RegExp对象
  if (obj instanceof RegExp) {
    return obj.toString();
  }
  
  // 处理Map对象
  if (obj instanceof Map) {
    return Array.from(obj.entries()).sort((a, b) => 
      String(a[0]).localeCompare(String(b[0]))
    );
  }
  
  // 处理Set对象
  if (obj instanceof Set) {
    return Array.from(obj.values()).sort();
  }
  
  // 处理ArrayBuffer和TypedArray
  if (ArrayBuffer.isView(obj)) {
    return Array.from(new Uint8Array(obj.buffer));
  }
  
  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeObject(item, seen));
  }
  
  // 处理普通对象 - 排序属性
  const sortedObj = {};
  Object.keys(obj)
    .sort()
    .forEach(key => {
      const value = obj[key];
      
      // 处理特殊值
      if (value === undefined) {
        sortedObj[key] = '__undefined__';
      } else if (typeof value === 'number' && isNaN(value)) {
        sortedObj[key] = '__NaN__';
      } else if (value === Infinity) {
        sortedObj[key] = '__Infinity__';
      } else if (value === -Infinity) {
        sortedObj[key] = '__-Infinity__';
      } else if (value instanceof Error) {
        sortedObj[key] = `Error: ${value.message}`;
      } else {
        sortedObj[key] = normalizeObject(value, seen);
      }
    });
  
  return sortedObj;
}

/**
 * 稳定序列化 - 确保相同对象总是产生相同字符串
 * @param {any} obj - 输入对象
 * @returns {string} 稳定字符串表示
 */
export function stableStringify(obj) {
  // 基本类型直接使用JSON.stringify
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  // 处理已经规范化的对象
  return JSON.stringify(obj);
}

/**
 * 高效字符串哈希函数 (基于FNV-1a算法)
 * @param {string} str - 输入字符串
 * @param {number} [bitLength=32] - 哈希长度 (32 或 64)
 * @returns {string} 十六进制哈希值
 */
export function hashString(str, bitLength = 32) {
  // 空字符串处理
  if (str.length === 0) {
    return '0'.repeat(bitLength / 4);
  }
  
  // 短字符串直接返回（避免不必要的哈希计算）
  if (str.length <= 64) {
    // 跨平台的Base64编码
    const encoded = base64Encode(str);
    return encoded.substring(0, bitLength / 4);
  }
  
  // 根据请求的位长选择哈希算法
  if (bitLength === 64) {
    return fnv1a64(str);
  }
  
  // 默认使用32位哈希
  return fnv1a32(str);
}

/**
 * 跨平台Base64编码
 * @param {string} str - 输入字符串
 * @returns {string} Base64编码字符串
 */
function base64Encode(str) {
  // 浏览器环境
  if (typeof btoa === 'function') {
    return btoa(encodeURIComponent(str)).replace(/[+/=]/g, '');
  }
  
  // Node.js环境
  if (typeof Buffer === 'function') {
    return Buffer.from(str, 'utf8').toString('base64').replace(/[+/=]/g, '');
  }
  
  // 回退方案：简单编码
  return Array.from(str)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 32位FNV-1a哈希算法
 * @param {string} str - 输入字符串
 * @returns {string} 32位十六进制哈希值
 */
function fnv1a32(str) {
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;
  
  let hash = FNV_OFFSET_BASIS;
  
  // 使用循环展开优化性能
  const len = str.length;
  let i = 0;
  
  // 处理4字节块
  while (i + 4 <= len) {
    hash ^= str.charCodeAt(i++);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i++);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i++);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i++);
    hash = Math.imul(hash, FNV_PRIME);
  }
  
  // 处理剩余字节
  while (i < len) {
    hash ^= str.charCodeAt(i++);
    hash = Math.imul(hash, FNV_PRIME);
  }
  
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 64位FNV-1a哈希算法
 * @param {string} str - 输入字符串
 * @returns {string} 64位十六进制哈希值
 */
function fnv1a64(str) {
  // 64位常量 (BigInt)
  const FNV_OFFSET_BASIS = BigInt('0xcbf29ce484222325');
  const FNV_PRIME = BigInt('0x100000001b3');
  
  let hash = FNV_OFFSET_BASIS;
  
  // 使用循环展开优化性能
  const len = str.length;
  let i = 0;
  
  // 处理4字节块
  while (i + 4 <= len) {
    hash ^= BigInt(str.charCodeAt(i++));
    hash *= FNV_PRIME;
    
    hash ^= BigInt(str.charCodeAt(i++));
    hash *= FNV_PRIME;
    
    hash ^= BigInt(str.charCodeAt(i++));
    hash *= FNV_PRIME;
    
    hash ^= BigInt(str.charCodeAt(i++));
    hash *= FNV_PRIME;
  }
  
  // 处理剩余字节
  while (i < len) {
    hash ^= BigInt(str.charCodeAt(i++));
    hash *= FNV_PRIME;
  }
  
  // 转换为64位十六进制字符串
  return hash.toString(16).padStart(16, '0');
}
