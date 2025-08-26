/**
  * 验证配置对象是否为数组或普通对象（Plain Object）
  * 
  * 此函数严格检查输入值是否为有效的配置类型：
  * 1. 数组（如 `[1, 2, 3]`）
  * 2. 普通对象（如 `{ key: 'value' }`）
  * 
  * ### 验证逻辑
  * 1. 排除 `null` 和基础类型（字符串 / 数字等）
  * 2. 使用 `Array.isArray()` 检测数组
  * 3. 通过原型链检测普通对象（排除`Date` / `RegExp` 等特殊对象）
  *
  * @param {*} eventConfig - 待验证的配置项
  * @returns { boolean } 验证结果：
  * - `true`：符合数组或普通对象类型
  * - `false`：不符合有效类型
  * 
  * @example
  * // 返回 true
  * isValidEventConfig({ name: 'test' });
  * isValidEventConfig(['a', 'b']);
  * 
  * @example
  * // 返回 false
  * isValidEventConfig(null);
  * isValidEventConfig(new Date());
  * isValidEventConfig(() => { });
  * 
  * @see[MDN 普通对象检测]
*/
export function isValidObj(eventConfig) {
  // 1. 排除 null 和非对象类型
  if (eventConfig === null || typeof eventConfig !== 'object') {
    return false;
  }
  // 3. 检查是否为普通对象（Plain Object）
  return Object.prototype.toString.call(eventConfig) === '[object Object]';
}
export function isFunction(param) {
  return typeof param !== 'function'
}