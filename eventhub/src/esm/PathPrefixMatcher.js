/**
 * 增强版路径前缀匹配器
 * 记录每个前缀对应的完整路径数组，支持快速查询
 */
export class EnhancedPathPrefixMatcher {
  /**
   * 构造函数
   * @param {string[]} paths - 路径字符串数组
   */
  constructor(paths = []) {
    this.pathSet = new Set(paths);
    this.prefixMap = new Map(); // 前缀 -> 完整路径数组的映射

    // 预处理所有路径，构建前缀映射
    this._buildPrefixMap();
  }

  /**
   * 构建前缀映射
   * @private
   */
  _buildPrefixMap() {
    // 清空现有映射
    this.prefixMap.clear();

    for (const path of this.pathSet) {
      const parts = path.split(':');

      // 为每个路径生成所有可能的前缀
      for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join(':');

        // 如果此前缀尚未记录，则初始化一个空数组
        if (!this.prefixMap.has(prefix)) {
          this.prefixMap.set(prefix, []);
        }

        // 将完整路径添加到此前缀对应的数组中
        this.prefixMap.get(prefix).push(path);
      }
    }
  }

  /**
   * 检查给定前缀是否存在且是路径（非最终值）
   * @param {string} prefix - 要检查的前缀
   * @returns {boolean} 是否存在且是路径
   */
  isPathPrefix(prefix) {
    return this.prefixMap.has(prefix) && this.prefixMap.get(prefix).length > 0;
  }

  /**
   * 获取以给定前缀开头的所有完整路径
   * @param {string} prefix - 前缀
   * @returns {string[]} 所有匹配的完整路径数组
   */
  getPathsByPrefix(prefix) {
    return this.prefixMap.has(prefix) ? [...this.prefixMap.get(prefix)] : [];
  }

  /**
   * 获取所有可能的前缀
   * @returns {string[]} 所有前缀数组
   */
  getAllPrefixes() {
    return Array.from(this.prefixMap.keys());
  }

  /**
   * 添加新路径到匹配器
   * @param {string} path - 新路径
   */
  addPath(path) {
    if (this.pathSet.has(path)) return; // 已存在则跳过

    this.pathSet.add(path);
    const parts = path.split(':');

    // 更新前缀映射
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join(':');

      if (!this.prefixMap.has(prefix)) {
        this.prefixMap.set(prefix, []);
      }

      // 添加路径到前缀对应的数组
      this.prefixMap.get(prefix).push(path);
    }
  }

  /**
   * 批量添加路径
   * @param {string[]} paths - 路径数组
   */
  addPaths(paths) {
    for (const path of paths) {
      this.addPath(path);
    }
  }

  /**
   * 从匹配器中移除路径
   * @param {string} path - 要移除的路径
   */
  removePath(path) {
    if (!this.pathSet.has(path)) return; // 不存在则跳过

    this.pathSet.delete(path);
    const parts = path.split(':');

    // 更新前缀映射
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join(':');

      if (this.prefixMap.has(prefix)) {
        const pathArray = this.prefixMap.get(prefix);
        const index = pathArray.indexOf(path);

        if (index !== -1) {
          pathArray.splice(index, 1);

          // 如果数组为空，删除此前缀
          if (pathArray.length === 0) {
            this.prefixMap.delete(prefix);
          }
        }
      }
    }
  }

  /**
   * 获取所有路径
   * @returns {string[]} 所有路径数组
   */
  getPaths() {
    return Array.from(this.pathSet);
  }

  /**
   * 清空所有路径
   */
  clear() {
    this.pathSet.clear();
    this.prefixMap.clear();
  }

  /**
   * 重新构建前缀映射（当外部直接修改路径集合后调用）
   */
  rebuild() {
    this._buildPrefixMap();
  }
}
