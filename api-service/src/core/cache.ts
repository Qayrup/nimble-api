interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

export class MemoryCache {
  #store = new Map<string, CacheEntry>();

  get(key: string): unknown | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > entry.ttl) {
      return undefined;
    }
    return entry.data;
  }

  getStale(key: string): { data: unknown; stale: boolean } | undefined {
    const entry = this.#store.get(key);
    if (!entry) return undefined;
    const expired = Date.now() - entry.timestamp > entry.ttl;
    return { data: entry.data, stale: expired };
  }

  set(key: string, value: unknown, ttl: number): void {
    this.#store.set(key, { data: value, timestamp: Date.now(), ttl });
  }

  delete(key: string): void {
    this.#store.delete(key);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.#store.clear();
  }
}
