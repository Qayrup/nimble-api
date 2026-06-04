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

### `set(key, value, ttl, tags?)`

设置缓存，支持标签。超出 maxSize 时自动淘汰 LRU 条目。

```ts
cache.set('key-1', { name: 'Alice' }, 30000, ['users', 'profile']);
```

### `delete(key)` / `has(key)` / `clear()`

基本缓存操作。`has()` 会自动检查 TTL 过期。

### `invalidateByTags(tags)`

按标签批量失效，利用内部的 `Map<string, Set<string>>` 反向索引实现 O(1) 查找。

```ts
cache.invalidateByTags(['users']);
// 所有带 'users' 标签的缓存条目被移除
```

### `invalidateByKey(key)`

`delete()` 的别名，按 key 失效单条缓存。

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

基于 FNV-1a 哈希算法，对 `URL` + `params` + `body` 生成稳定的缓存 key，确保对象 key 顺序不影响 hash 值。

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
