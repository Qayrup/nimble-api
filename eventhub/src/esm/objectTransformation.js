/**
 * 将嵌套对象转换回字符串数组
 * 只关注对象结构，忽略叶子节点的值和$前缀属性
 * @param {...Object} objects - 要转换的对象（可接受多个参数）
 * @returns {string[]} 生成的字符串数组
 * @throws {Error} 当存在结构冲突时抛出错误
 */
function objectsToStrings(...objects) {
  const resultSet = new Set(); // 使用Set来存储结果，自动去重

  // 递归处理每个对象
  for (const obj of objects) {
    processObject(obj, [], resultSet);
  }
  return Array.from(resultSet);
}

/**
 * 递归处理对象，提取路径（忽略$前缀属性）
 * @param {Object} obj - 要处理的对象
 * @param {string[]} currentPath - 当前路径
 * @param {Set} resultSet - 存储结果的Set
 */
function processObject(obj, currentPath, resultSet) {
  // 检查当前对象是否是叶子节点（没有子对象）
  if (typeof obj !== 'object' || obj === null) {
    // 忽略叶子节点的值，只根据路径生成字符串
    const pathStr = currentPath.join(':');
    resultSet.add(pathStr);
    return;
  }

  // 处理对象的所有属性，但忽略$前缀属性
  for (const [key, value] of Object.entries(obj)) {
    // 跳过以$开头的属性
    if (key.startsWith('$')) continue;

    // 递归处理每个属性
    processObject(value, [...currentPath, key], resultSet);
  }
}

/**
 * 检查对象结构是否有效（确保没有混合结构，忽略$前缀属性）
 * @param {...Object} objects - 要检查的对象
 * @returns {boolean} 是否有效
 * @throws {Error} 当存在结构冲突时抛出错误
 */
function validateObjectStructure(...objects) {
  const pathMap = new Map(); // 存储路径和对应的类型
  // 递归检查每个对象，忽略$前缀属性
  for (const obj of objects) {
    checkObjectStructure(obj, [], pathMap);
  }

  return true;
}

/**
 * 递归检查对象结构（忽略$前缀属性）
 * @param {Object} obj - 要检查的对象
 * @param {string[]} currentPath - 当前路径
 * @param {Map} pathMap - 存储路径和类型的Map
 */
function checkObjectStructure(obj, currentPath, pathMap) {
  const pathStr = currentPath.join(':');
  const isLeaf = typeof obj !== 'object' || obj === null;

  // 检查路径是否已存在（忽略$前缀属性）
  if (pathMap.has(pathStr)) {
    const existingType = pathMap.get(pathStr);
    const currentType = isLeaf ? 'leaf' : 'node';

    // 如果类型不同，抛出错误
    if (existingType !== currentType) {
      throw new Error(`结构冲突: 路径 '${pathStr}' 既是叶子节点又是非叶子节点`);
    }
  } else {
    // 记录路径类型
    pathMap.set(pathStr, isLeaf ? 'leaf' : 'node');
  }

  // 如果不是叶子节点，继续递归检查（忽略$前缀属性）
  if (!isLeaf) {
    for (const [key, value] of Object.entries(obj)) {
      // 跳过以$开头的属性
      if (key.startsWith('$')) continue;

      checkObjectStructure(value, [...currentPath, key], pathMap);
    }
  }
}

/**
 * 安全转换函数（先验证结构，再转换）
 * @param {...Object} objects - 要转换的对象
 * @returns {string[]} 生成的字符串数组
 * @throws {Error} 当存在结构冲突时抛出错误
 */
export function safeObjectsToStrings(...objects) {
  // 先验证对象结构
  validateObjectStructure(...objects);

  // 然后进行转换
  return objectsToStrings(...objects);
}

/**
 * 将字符串数组转换回嵌套对象
 * 每个节点包含一个$前缀的同级属性用于存放该路径的值
 * @param {string[]} strings - 字符串数组
 * @returns {Object} 生成的嵌套对象
 * @throws {Error} 当存在路径冲突时抛出错误
 */
export function stringsToObject(strings) {
  const result = {};
  const pathMap = new Map(); // 用于检测路径冲突

  // 首先按路径长度排序，确保先处理较短的路径
  const sortedStrings = [...strings].sort((a, b) => {
    const aDepth = a.split(':').length;
    const bDepth = b.split(':').length;
    return aDepth - bDepth;
  });

  for (const str of sortedStrings) {
    const parts = str.split(':');
    let current = result;

    // 遍历路径的每个部分
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1).join(':');

      // 检查路径冲突
      if (pathMap.has(currentPath) && pathMap.get(currentPath) === 'leaf') {
        throw new Error(`路径冲突: '${currentPath}' 已经是叶子节点，不能添加子节点`);
      }

      // 如果是最后一个部分，设置叶子节点的值
      if (i === parts.length - 1) {
        // 检查路径冲突
        if (pathMap.has(currentPath) && pathMap.get(currentPath) === 'node') {
          throw new Error(`路径冲突: '${currentPath}' 已经是非叶子节点，不能设置为叶子节点`);
        }

        // 设置叶子节点的值
        current[part] = str;

        // 记录路径类型
        pathMap.set(currentPath, 'leaf');
      } else {
        // 如果不是最后一个部分，确保当前部分存在且是对象
        if (!current[part]) {
          current[part] = {};
        } else if (typeof current[part] === 'string') {
          // 如果已经是字符串，不能继续添加子属性
          throw new Error(`路径冲突: '${currentPath}' 已经是叶子节点，不能添加子节点`);
        }

        // 添加$前缀属性存储当前路径值
        const dollarKey = `$${part}`;
        current[dollarKey] = currentPath;

        // 记录路径类型
        pathMap.set(currentPath, 'node');

        // 移动到下一层
        current = current[part];
      }
    }
  }

  return result;
}


//格式化与被格式化
// ['BUILT:ERROR:LISTENER_OVERFLOW', 'BUILT:ERROR:LISTENER_REPEAT', 'BUILT:ERROR:HANDLER_ILLEGAL', 'BUILT:ERROR:DEFAULT', 'BUILT:ERROR:TEST']
//
/**           /\            **/
/**          //\\           **/
/**           ||            **/
/**           ||            **/
/**           ||            **/
/**           ||            **/
/**           ||            **/
/**          \\//           **/
/**           \/            **/
//
// {
//   $BUILT: 'BUILT',
//     BUILT: {
//     $ERROR: 'BUILT:ERROR',
//       ERROR: {
//       LISTENER_OVERFLOW: 'BUILT:ERROR:LISTENER_OVERFLOW',
//         LISTENER_REPEAT: 'BUILT:ERROR:LISTENER_REPEAT',
//           HANDLER_ILLEGAL: 'BUILT:ERROR:HANDLER_ILLEGAL',
//             DEFAULT: 'BUILT:ERROR:DEFAULT',
//               TEST: 'BUILT:ERROR:TEST'
//     }
//   }
// }
