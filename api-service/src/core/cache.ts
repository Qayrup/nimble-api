interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
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
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.#removeEntry(key, entry);
      return undefined;
    }
    // Bump to end (most recently used) — Map maintains insertion order
    this.#store.delete(key);
    this.#store.set(key, entry);
    return entry.data;
  }

  getStale(key: string): { data: unknown; stale: boolean } | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    const expired = Date.now() - entry.timestamp > entry.ttl;
    // Bump to end for LRU
    this.#store.delete(key);
    this.#store.set(key, entry);
    return { data: entry.data, stale: expired };
  }

  set(key: string, value: unknown, ttl: number, tags: string[] = []): void {
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

    const entry: CacheEntry = { data: value, timestamp: Date.now(), ttl, tags };
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
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.#removeEntry(key, entry);
      return false;
    }
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
