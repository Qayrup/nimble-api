interface CacheEntry {
  data: unknown;
  timestamp: number;
  staleTime: number;
  gcTime: number;
  lastAccess: number;
  tags: string[];
}

export class MemoryCache {
  #store = new Map<string, CacheEntry>();
  #tagIndex = new Map<string, Set<string>>();
  #maxSize: number;

  constructor(maxSize = Infinity) {
    this.#maxSize = maxSize;
  }

  /** Returns cached data if fresh (within staleTime and gcTime). Bumps LRU position on hit. */
  get(key: string): unknown | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;

    // Lazy gcTime cleanup
    if (Date.now() - entry.lastAccess > entry.gcTime) {
      this.#removeEntry(key, entry);
      return undefined;
    }

    // Check staleTime
    if (Date.now() - entry.timestamp > entry.staleTime) {
      this.#removeEntry(key, entry);
      return undefined;
    }

    // Bump LRU + lastAccess
    this.#store.delete(key);
    entry.lastAccess = Date.now();
    this.#store.set(key, entry);
    return entry.data;
  }

  getStale(key: string): { data: unknown; stale: boolean } | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;

    // Lazy gcTime cleanup
    if (Date.now() - entry.lastAccess > entry.gcTime) {
      this.#removeEntry(key, entry);
      return undefined;
    }

    const stale = Date.now() - entry.timestamp > entry.staleTime;

    // Bump LRU + lastAccess
    this.#store.delete(key);
    entry.lastAccess = Date.now();
    this.#store.set(key, entry);
    return { data: entry.data, stale };
  }

  set(key: string, value: unknown, staleTime: number, tags: string[] = [], gcTime?: number): void {
    const effectiveGcTime = gcTime ?? Infinity;

    // Evict if at capacity (remove LRU = first key in Map)
    if (this.#store.size >= this.#maxSize && !this.#store.has(key)) {
      const lruKey = this.#store.keys().next().value;
      if (lruKey !== undefined) {
        const lruEntry = this.#store.get(lruKey);
        if (lruEntry) this.#removeEntry(lruKey, lruEntry);
      }
    }

    // Remove old entry + old tag indices if updating
    const old = this.#store.get(key);
    if (old) this.#removeEntry(key, old, true);

    const now = Date.now();
    const entry: CacheEntry = {
      data: value,
      timestamp: now,
      staleTime,
      gcTime: effectiveGcTime,
      lastAccess: now,
      tags,
    };
    this.#store.set(key, entry);

    for (const tag of tags) {
      let set = this.#tagIndex.get(tag);
      if (!set) {
        set = new Set();
        this.#tagIndex.set(tag, set);
      }
      set.add(key);
    }
  }

  delete(key: string): void {
    const entry = this.#store.get(key);
    if (entry) this.#removeEntry(key, entry);
  }

  /** Returns true if the key exists and is fresh. Does NOT bump LRU — use get() if you need access tracking. */
  has(key: string): boolean {
    const entry = this.#store.get(key);
    if (!entry) return false;

    if (Date.now() - entry.lastAccess > entry.gcTime) {
      this.#removeEntry(key, entry);
      return false;
    }
    if (Date.now() - entry.timestamp > entry.staleTime) {
      this.#removeEntry(key, entry);
      return false;
    }
    return true;
  }

  /** Bump LRU position and update lastAccess — use when you want to mark a key as "recently used" without reading it. */
  touch(key: string): void {
    const entry = this.#store.get(key);
    if (!entry) return;
    this.#store.delete(key);
    entry.lastAccess = Date.now();
    this.#store.set(key, entry);
  }

  clear(): void {
    this.#store.clear();
    this.#tagIndex.clear();
  }

  invalidateByTags(tags: string[]): void {
    for (const tag of tags) {
      const keys = this.#tagIndex.get(tag);
      if (keys) {
        for (const key of [...keys]) {
          const entry = this.#store.get(key);
          if (entry) this.#removeEntry(key, entry);
        }
      }
    }
  }

  invalidateByKey(key: string): void {
    this.delete(key);
  }

  invalidateByKeyPrefix(prefix: string): void {
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) {
        const entry = this.#store.get(key);
        if (entry) this.#removeEntry(key, entry);
      }
    }
  }

  exportState(): string {
    const entries: Array<Record<string, unknown>> = [];
    for (const [key, entry] of this.#store) {
      entries.push({
        key,
        data: entry.data,
        timestamp: entry.timestamp,
        staleTime: entry.staleTime === Infinity ? 'Infinity' : entry.staleTime,
        gcTime: entry.gcTime === Infinity ? 'Infinity' : entry.gcTime,
        lastAccess: entry.lastAccess,
        tags: entry.tags,
      });
    }
    return JSON.stringify({ entries, maxSize: this.#maxSize });
  }

  importState(json: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }

    const state = parsed as {
      entries: Array<{
        key: string;
        data: unknown;
        timestamp: number;
        staleTime: number | 'Infinity';
        gcTime: number | 'Infinity';
        lastAccess: number;
        tags: string[];
      }>;
      maxSize: number;
    };

    if (!state || !Array.isArray(state.entries)) return false;

    // Validate all entries before clearing — reject the whole import if any field is corrupt
    for (const item of state.entries) {
      if (typeof item.key !== 'string') return false;
      if (!Number.isFinite(item.timestamp)) return false;
      if (!Number.isFinite(item.lastAccess)) return false;
      if (item.staleTime !== 'Infinity' && !(typeof item.staleTime === 'number' && Number.isFinite(item.staleTime))) return false;
      if (item.gcTime !== 'Infinity' && !(typeof item.gcTime === 'number' && Number.isFinite(item.gcTime))) return false;
      if (!Array.isArray(item.tags)) return false;
    }

    this.clear();
    this.#maxSize = state.maxSize ?? Infinity;

    for (const item of state.entries) {
      const entry: CacheEntry = {
        data: item.data,
        timestamp: item.timestamp,
        staleTime: item.staleTime === 'Infinity' ? Infinity : (item.staleTime as number),
        gcTime: item.gcTime === 'Infinity' ? Infinity : (item.gcTime as number),
        lastAccess: item.lastAccess,
        tags: item.tags,
      };
      this.#store.set(item.key, entry);

      for (const tag of item.tags) {
        let set = this.#tagIndex.get(tag);
        if (!set) {
          set = new Set();
          this.#tagIndex.set(tag, set);
        }
        set.add(item.key);
      }
    }
    return true;
  }

  get size(): number {
    return this.#store.size;
  }

  get maxSize(): number {
    return this.#maxSize;
  }

  #removeEntry(key: string, entry: CacheEntry, skipStore = false): void {
    if (!skipStore) this.#store.delete(key);
    for (const tag of entry.tags) {
      const set = this.#tagIndex.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.#tagIndex.delete(tag);
      }
    }
  }
}
