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
  metaMode?: 'smart' | 'full' | 'lean' | 'simple';
  emitMode?: 'aggregate' | 'failFast' | 'silent';
  emitSafety?: 'safe' | 'fast';
  maxListenersAction?: 'warn' | 'throw' | 'silent' | ((event: string, count: number) => void);
}
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `delimiter` | `string?` | `':./'` | 用于 `onPattern` glob 匹配的分隔符字符集 |
| `metaMode` | `'smart' \| 'full' \| 'lean' \| 'simple'` | `'smart'` | 移除监听时 meta 事件的 handler 携带策略（见下方矩阵） |
| `emitMode` | `'aggregate' \| 'failFast' \| 'silent'` | `'aggregate'` | 同步 `emit()` 中 handler 错误的处理策略 |
| `emitSafety` | `'safe' \| 'fast'` | `'safe'` | `safe`=快照迭代（默认），`fast`=直接迭代（零分配，但 handler 中 unsubscribe 会跳过下一个） |
| `maxListenersAction` | `'warn' \| 'throw' \| 'silent' \| callback` | `'warn'` | 超出最大监听数时的行为。回调模式下每次超出都调用，不做去重 |

### metaMode 矩阵

| 模式 | 单次移除 | 批量移除 |
|------|------|------|
| `smart` (默认) | `{ event, handler }` | `{ event }` 一次 |
| `full` | `{ event, handler }` | `{ event, handler }` 逐条 |
| `lean` | `{ event }` | `{ event }` 一次 |
| `simple` | 不触发 | 不触发 |

```ts
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

`on()` / `prependListener()` / `prependOnceListener()` / `onAny()` / `onPattern()` / `many()` 的可选参数。

```ts
export interface SubscribeOptions {
  signal?: AbortSignal;
  debounce?: number;
  throttle?: number;
  throttleEdge?: 'both' | 'leading' | 'trailing';
}
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `signal` | `AbortSignal?` | — | 取消信号，abort 时自动取消订阅 |
| `debounce` | `number?` | — | 防抖（ms），handler 在事件流静默指定时长后才触发 |
| `throttle` | `number?` | — | 节流（ms），handler 最多每隔指定时长触发一次 |
| `throttleEdge` | `'both' \| 'leading' \| 'trailing'` | `'both'` | throttle 发射边策略 |

> 同时设置 `debounce` 和 `throttle` 时，`throttle` 优先生效。

### throttleEdge 详解

| 值 | 行为 | 适用场景 |
|------|------|------|
| `both` (默认) | 首次立即发 + 结束时补发一次 | 通用场景 |
| `leading` | 仅首次立即发，窗口内后续忽略 | 按钮防重复点击 |
| `trailing` | 仅窗口结束后发，首次不发 | window resize 等只关心最终状态 |

```ts
hub.on('submit', handleSubmit, { throttle: 500, throttleEdge: 'leading' });
hub.on('resize', handleResize, { throttle: 200, throttleEdge: 'trailing' });
```

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
  beforeListenerAdd: { event: string; handler: (...args: any[]) => void };
  listenerAdded: { event: string };
  beforeListenerRemove: { event: string; handler?: (...args: any[]) => void };
  listenerRemoved: { event: string };
}
```

| 元事件 | 时机 | handler 字段 | 抛错行为 |
|------|------|------|------|
| `beforeListenerAdd` | 添加前 | ✅ 自带 | 穿透阻止添加 |
| `listenerAdded` | 添加后 | ❌ | 静默忽略 |
| `beforeListenerRemove` | 移除前 | ⚠️ 可选（批量 `offAll` 时为 `undefined`） | 穿透阻止移除 |
| `listenerRemoved` | 移除后 | ❌ | 静默忽略 |

> `handler` 字段在 `beforeListenerRemove` 中为可选——单次移除（`off`/`unsub`）时携带，批量移除（`offAll`）时根据 `metaMode` 决定是否携带。
