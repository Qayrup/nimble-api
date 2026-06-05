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

  has(key: string): boolean {
    const entry = this.#store.get(key);
    if (!entry) return false;

    if (Date.now() - entry.lastAccess > entry.gcTime) {
      this.#removeEntry(key, entry);
      return false;
    }
    if (Date.now() - entry.timestamp > entry.staleTime) {
      return false;
    }
    // Bump LRU + lastAccess
    this.#store.delete(key);
    entry.lastAccess = Date.now();
    this.#store.set(key, entry);
    return true;
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
        staleTime: entry.staleTime,
        gcTime: entry.gcTime,
        lastAccess: entry.lastAccess,
        tags: entry.tags,
      });
    }
    return JSON.stringify({ entries, maxSize: this.#maxSize });
  }

  importState(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return; // corrupted JSON, ignore silently
    }

    const state = parsed as {
      entries: Array<{
        key: string;
        data: unknown;
        timestamp: number;
        staleTime: number;
        gcTime: number;
        lastAccess: number;
        tags: string[];
      }>;
      maxSize: number;
    };

    if (!state || !Array.isArray(state.entries)) return;

    this.clear();
    this.#maxSize = state.maxSize ?? Infinity;

    for (const item of state.entries) {
      const entry: CacheEntry = {
        data: item.data,
        timestamp: item.timestamp,
        staleTime: item.staleTime ?? Infinity,
        gcTime: item.gcTime ?? Infinity,
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
