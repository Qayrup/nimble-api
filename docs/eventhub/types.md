# EventHub 类型定义

## 泛型参数

`EventHub<T>` 接受一个事件映射类型作为泛型参数，默认为 `Record<string, unknown>`：

```ts
// T 默认为 Record<string, unknown>，所有事件名和载荷均可自由定义
const hub = createEventHub();

// 显式传入事件映射以获得类型安全
interface MyEvents {
  'user:login': { userId: string };
  'user:logout': { userId: string };
  'order:created': { orderId: string; amount: number };
}
const typedHub = createEventHub<MyEvents>();
```

---

## `EventHubOptions`

构造 `EventHub` 或调用 `createEventHub` 时的可选配置。

```ts
export interface EventHubOptions {
  delimiter?: string;
}
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `delimiter` | `string?` | `':./'` | 用于 `onPattern` glob 匹配的分隔符字符集 |

分隔符用于 `onPattern` 的 `*`（单段）和 `**`（多段）通配符。默认 `:./` 覆盖了常见的命名空间分隔符：

```ts
// 默认分隔符下，user:login 中 : 为分隔符
hub.onPattern('user:*', handler);   // 匹配 user:login，不匹配 user:login:extra

// 自定义分隔符
const hub = createEventHub({ delimiter: '/.' });
hub.onPattern('users/*', handler);  // 匹配 users/123，不匹配 users/123/posts
```

---

## Glob 通配符语法

`onPattern` 支持以下通配符：

| 模式 | 匹配范围 | 示例 (默认分隔符 `:./`) |
|------|------|------|
| `*` | 单段 — 不跨越分隔符 | `user:*` 匹配 `user:login`、`user:logout`，不匹配 `user:login:extra` |
| `**` | 多段 — 跨越任意层分隔符 | `user:**` 匹配 `user:login`、`user:login:extra`，不匹配 `order:created` |
| `?` | 单个非分隔符字符 | `order:???????` 匹配 `order:created`（7 个字符） |

分隔符由 `EventHubOptions.delimiter` 控制，默认为 `:./`。

```ts
// 多段匹配 — 捕获所有 user:* 及其子事件
hub.onPattern('user:**', (event, payload) => { /* ... */ });
hub.emit('user:login');           // ✅ 匹配
hub.emit('user:login:success');   // ✅ 匹配
hub.emit('order:created');        // ❌ 不匹配
```

---

## `SubscribeOptions`

`on()` / `onAny()` / `onPattern()` / `many()` 的可选参数。

```ts
export interface SubscribeOptions {
  signal?: AbortSignal;
  debounce?: number;
  throttle?: number;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `signal` | `AbortSignal?` | 取消信号，abort 时自动取消订阅 |
| `debounce` | `number?` | 防抖（ms），handler 在事件流静默指定时长后才触发 |
| `throttle` | `number?` | 节流（ms），handler 最多每隔指定时长触发一次（leading edge） |

> 同时设置 `debounce` 和 `throttle` 时，`throttle` 优先生效。

---

## `Unsubscribe`

`on()` / `onAny()` / `onPattern()` / `many()` / `prependListener()` 返回的取消订阅函数。

```ts
export type Unsubscribe = () => void;
```

调用即移除对应的 listener，幂等安全。

---

## `MetaEventPayloads`

内部元事件的载荷类型，仅作参考。

```ts
export interface MetaEventPayloads {
  listenerAdded: { event: string };
  listenerRemoved: { event: string };
}
```
