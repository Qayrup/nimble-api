# 缓存系统

API Service 内置一个独立可用的 `MemoryCache` 类，同时与 `ApiClient` 深度集成。

## MemoryCache

基于 `Map` 实现的 LRU 内存缓存，支持 TTL 过期和标签索引。

```ts
import { MemoryCache } from '@nimble-api/api-service';

const cache = new MemoryCache(100); // maxSize = 100
```

### `get(key)`

获取缓存值，自动检查 TTL 过期。命中时将条目移到 LRU 末尾（最近使用）。

```ts
const data = cache.get('key-1');
// 过期返回 undefined
```

### `getStale(key)`

用于 SWR (stale-while-revalidate) 模式。返回 `{ data, stale }` 结构：

```ts
const result = cache.getStale('key-1');
if (result && !result.stale) {
  // 新鲜数据，直接使用
} else if (result) {
  // 过期数据，先用旧数据，同时后台刷新
}
```

### `set(key, value, staleTime, tags?, gcTime?)`

设置缓存，支持标签和垃圾回收时间。超出 maxSize 时自动淘汰 LRU 条目。

```ts
cache.set('key-1', { name: 'Alice' }, 30000, ['users', 'profile']);
// 带 gcTime — 条目 5 分钟内未被访问则惰性删除
cache.set('key-2', { name: 'Bob' }, 60000, ['users'], 300000);
```

### `delete(key)` / `has(key)` / `clear()`

基本缓存操作。`has()` 会自动检查 TTL 和 gcTime 过期，两者任一过期即返回 `false`。

### `invalidateByTags(tags)`

按标签批量失效，利用内部的 `Map<string, Set<string>>` 反向索引实现 O(1) 查找。

```ts
cache.invalidateByTags(['users']);
// 所有带 'users' 标签的缓存条目被移除
```

### `invalidateByKey(key)`

按 key 失效单条缓存。

### `invalidateByKeyPrefix(prefix)`

按 key 前缀批量失效。适用于批量清除同一资源的所有缓存变体。

```ts
cache.invalidateByKeyPrefix('/api/users');
// '/api/users', '/api/users/1', '/api/users/1/posts' 等全部失效
```

### `exportState()` / `importState(json)`

导出/导入缓存完整状态（含数据、时间戳、标签索引）。用于 SSR 快照、跨端同步等场景。

```ts
// 序列化当前缓存状态
const snapshot = cache.exportState();

// 在另一端还原
const newCache = new MemoryCache(200);
newCache.importState(snapshot);
```

### gcTime 垃圾回收

每个缓存条目可单独设置 `gcTime`。当条目距离上次访问超过 `gcTime` 时，在 `get()` / `getStale()` / `has()` 调用时**惰性删除**。`gcTime` 默认 **5 分钟**（与 TanStack Query 一致），设 `Infinity` 可永不回收。

```ts
// 缓存条目在最近 5 分钟内未被访问则自动回收
cache.set('key', data, 30000, ['users'], 300000);
//                                      ^^^^^^ gcTime = 5min
```

| 参数 | 说明 |
|------|------|
| `staleTime` (ttl) | 数据新鲜度——过期视为 stale |
| `gcTime` | 垃圾回收——过期立即删除 |

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `size` | `number` | 当前条目数（只读） |
| `maxSize` | `number` | 最大容量（只读） |

---

## ApiClient 缓存集成

### 配置方式

**全局配置（构造函数）：**

```ts
const api = createApiClient({
  cache: { ttl: 30000, mode: 'ttl', maxSize: 200 },
});

// 或禁用缓存
const api = createApiClient({ cache: false });
```

**请求级配置：**

```ts
// 控制缓存行为
await api.get('/users', {
  cache: { ttl: 10000, mode: 'swr', tags: ['users'], skip: false },
});

// 跳过缓存
await api.get('/users', { cache: { skip: true } });
```

### 缓存模式

| 模式 | 行为 |
|------|------|
| `ttl` | TTL 内命中直接返回，过期重新请求 |
| `swr` | 新鲜数据直接返回；过期数据先返回旧值，后台自动刷新 |

### 缓存 Key 生成

基于 FNV-1a 哈希算法，对 `URL` + `params` + `body` + `searchParams` + `method` 生成稳定的缓存 key。不同分页参数、GET/HEAD 等不会错误共享缓存：

```ts
import { generateCacheKey } from '@nimble-api/api-service';

const key = generateCacheKey('/users/{id}', { id: '1' }, {}, { page: '1' }, 'GET');
// key: "c8a7b3..." — FNV-1a 64-bit hash hex string
```

特性：
- 对象 key 按字母序排序后序列化，确保 `{a:1,b:2}` 和 `{b:2,a:1}` 生成相同 hash
- 仅当 `cache.ttl > 0` 时才生成 key（TTL=0 时不缓存）
- URL 模板参数已被替换为实际值后才参与 hash
- `searchParams` 和 `method` 参与 hash，避免不同分页/HTTP 方法错误共享缓存

### gcTime 全局配置

```ts
const api = createApiClient({
  cache: { ttl: 60000, gcTime: 300000 },
});

await api.get('/users/1', {
  cache: { gcTime: 600000 }, // 单个请求可覆盖 gcTime
});
```

`gcTime` 到达后条目在下次访问时惰性删除。设为 `0` 可立即回收。

### 实体标签

通过 `entities` 配置从响应中提取实体，自动建立标签索引：

```ts
await api.get('/users', {
  entities: [{ name: 'user', idKey: 'id' }],
});
// 响应 [{ id: '1', name: 'A' }, { id: '2', name: 'B' }]
// 自动创建 @entity:user:1 和 @entity:user:2 缓存条目，标签 'user'
```

### 缓存失效

```ts
// 请求成功后自动失效指定标签
await api.post('/users', {
  json: { name: 'Alice' },
  invalidates: ['users'], // 成功后失效所有 users 标签的缓存
});
```

### 请求去重

相同请求的并发调用自动去重（基于 `METHOD:URL:BODY` 的 dedup key），只发出一次真实 HTTP 请求，其他调用者共享同一个 Promise 结果。
