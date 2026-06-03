/**
 * 增强版路径前缀匹配器
 * 记录每个前缀对应的完整路径数组，支持快速查询
 */
export class EnhancedPathPrefixMatcher {
  private pathSet: Set<string>;
  private prefixMap: Map<string, string[]>;

  constructor(paths: string[] = []) {
    this.pathSet = new Set(paths);
    this.prefixMap = new Map();

    // 预处理所有路径，构建前缀映射
    this._buildPrefixMap();
  }

  /**
   * 构建前缀映射
   */
  private _buildPrefixMap(): void {
    this.prefixMap.clear();

    for (const path of this.pathSet) {
      const parts = path.split(':');
      let prefix = parts[0];

      for (let i = 1; i < parts.length; i++) {
        if (!this.prefixMap.has(prefix)) {
          this.prefixMap.set(prefix, []);
        }
        this.prefixMap.get(prefix)!.push(path);
        prefix = prefix + ':' + parts[i];
      }
    }
  }

  /**
   * 检查给定前缀是否存在且是路径（非最终值）
   */
  isPathPrefix(prefix: string): boolean {
    return this.prefixMap.has(prefix);
  }

  /**
   * 获取以给定前缀开头的所有完整路径
   */
  getPathsByPrefix(prefix: string): readonly string[] {
    return this.prefixMap.get(prefix) ?? [];
  }

  /**
   * 获取所有可能的前缀
   */
  getAllPrefixes(): string[] {
    return Array.from(this.prefixMap.keys());
  }

  /**
   * 添加新路径到匹配器
   */
  addPath(path: string): void {
    if (this.pathSet.has(path)) return;

    this.pathSet.add(path);
    const parts = path.split(':');
    let prefix = parts[0];

    for (let i = 1; i < parts.length; i++) {
      if (!this.prefixMap.has(prefix)) {
        this.prefixMap.set(prefix, []);
      }
      this.prefixMap.get(prefix)!.push(path);
      prefix = prefix + ':' + parts[i];
    }
  }

  /**
   * 批量添加路径
   */
  addPaths(paths: string[]): void {
    for (const path of paths) {
      this.addPath(path);
    }
  }

  /**
   * 从匹配器中移除路径
   */
  removePath(path: string): void {
    if (!this.pathSet.has(path)) return;

    this.pathSet.delete(path);
    const parts = path.split(':');
    let prefix = parts[0];

    for (let i = 1; i < parts.length; i++) {
      if (this.prefixMap.has(prefix)) {
        const pathArray = this.prefixMap.get(prefix)!;
        const index = pathArray.indexOf(path);

        if (index !== -1) {
          pathArray.splice(index, 1);

          if (pathArray.length === 0) {
            this.prefixMap.delete(prefix);
          }
        }
      }
      prefix = prefix + ':' + parts[i];
    }
  }

  /**
   * 获取所有路径
   */
  getPaths(): string[] {
    return Array.from(this.pathSet);
  }

  /**
   * 清空所有路径
   */
  clear(): void {
    this.pathSet.clear();
    this.prefixMap.clear();
  }

  /**
   * 重新构建前缀映射（当外部直接修改路径集合后调用）
   */
  rebuild(): void {
    this._buildPrefixMap();
  }
}
