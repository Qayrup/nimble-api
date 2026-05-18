type NestedObject = Record<string, unknown>;

/**
 * 将嵌套对象转换回字符串数组
 * 只关注对象结构，忽略叶子节点的值和$前缀属性
 */
function objectsToStrings(...objects: NestedObject[]): string[] {
  const resultSet = new Set<string>();

  for (const obj of objects) {
    processObject(obj, [], resultSet);
  }
  return Array.from(resultSet);
}

/**
 * 递归处理对象，提取路径（忽略$前缀属性）
 */
function processObject(
  obj: unknown,
  currentPath: string[],
  resultSet: Set<string>
): void {
  // 检查当前对象是否是叶子节点（没有子对象）
  if (typeof obj !== 'object' || obj === null) {
    const pathStr = currentPath.join(':');
    resultSet.add(pathStr);
    return;
  }

  // 处理对象的所有属性，但忽略$前缀属性
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    processObject(value, [...currentPath, key], resultSet);
  }
}

/**
 * 检查对象结构是否有效（确保没有混合结构，忽略$前缀属性）
 */
function validateObjectStructure(...objects: NestedObject[]): boolean {
  const pathMap = new Map<string, 'leaf' | 'node'>();

  for (const obj of objects) {
    checkObjectStructure(obj, [], pathMap);
  }
  return true;
}

/**
 * 递归检查对象结构（忽略$前缀属性）
 */
function checkObjectStructure(
  obj: unknown,
  currentPath: string[],
  pathMap: Map<string, 'leaf' | 'node'>
): void {
  const pathStr = currentPath.join(':');
  const isLeaf = typeof obj !== 'object' || obj === null;

  if (pathMap.has(pathStr)) {
    const existingType = pathMap.get(pathStr)!;
    const currentType = isLeaf ? 'leaf' : 'node';

    if (existingType !== currentType) {
      throw new Error(`结构冲突: 路径 '${pathStr}' 既是叶子节点又是非叶子节点`);
    }
  } else {
    pathMap.set(pathStr, isLeaf ? 'leaf' : 'node');
  }

  if (!isLeaf) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith('$')) continue;
      checkObjectStructure(value, [...currentPath, key], pathMap);
    }
  }
}

/**
 * 安全转换函数（先验证结构，再转换）
 */
export function safeObjectsToStrings(...objects: NestedObject[]): string[] {
  validateObjectStructure(...objects);
  return objectsToStrings(...objects);
}

/**
 * 将字符串数组转换回嵌套对象
 * 每个节点包含一个$前缀的同级属性用于存放该路径的值
 */
export function stringsToObject(strings: string[]): Record<string, string | Record<string, unknown>> {
  const result: Record<string, string | Record<string, unknown>> = {};
  const pathMap = new Map<string, 'leaf' | 'node'>();

  // 首先按路径长度排序，确保先处理较短的路径
  const sortedStrings = [...strings].sort((a, b) => {
    const aDepth = a.split(':').length;
    const bDepth = b.split(':').length;
    return aDepth - bDepth;
  });

  for (const str of sortedStrings) {
    const parts = str.split(':');
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1).join(':');

      // 检查路径冲突
      if (pathMap.has(currentPath) && pathMap.get(currentPath) === 'leaf') {
        throw new Error(`路径冲突: '${currentPath}' 已经是叶子节点，不能添加子节点`);
      }

      if (i === parts.length - 1) {
        if (pathMap.has(currentPath) && pathMap.get(currentPath) === 'node') {
          throw new Error(`路径冲突: '${currentPath}' 已经是非叶子节点，不能设置为叶子节点`);
        }

        current[part] = str;
        pathMap.set(currentPath, 'leaf');
      } else {
        if (!current[part]) {
          current[part] = {};
        } else if (typeof current[part] === 'string') {
          throw new Error(`路径冲突: '${currentPath}' 已经是叶子节点，不能添加子节点`);
        }

        const dollarKey = `$${part}`;
        current[dollarKey] = currentPath;
        pathMap.set(currentPath, 'node');
        current = current[part] as Record<string, unknown>;
      }
    }
  }

  return result;
}
