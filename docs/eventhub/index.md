# EventHub 概述

`@nimble-api/eventhub` 是一个轻量级的 TypeScript 事件管理器，零外部依赖，提供完整类型推导的事件订阅与派发能力。

## 设计理念

- **类型安全** — 通过 `EventMap` 泛型约束事件名与载荷类型，编译期即可发现错误
- **O(1) 查找** — 底层使用 `Map<string, HandlerRecord[]>` 实现，查找复杂度 O(1)
- **快照安全** — `emit()` 期间增删监听器不影响当前发射周期（可切换为 `fast` 模式零分配）
- **惰性函数** — 所有模式决策在构造时完成，运行时热路径零分支开销
- **全面可配置** — emit 错误策略、快照模式、meta 事件粒度、maxListeners 行为均可按需选择
- **多范式** — 支持回调订阅、Promise 一次性、AsyncIterable 流式消费、防抖/节流、glob 通配符

## 核心概念

### EventMap

所有事件类型通过泛型参数传入，K 为事件名，V 为载荷类型：

```ts
// 直接定义事件映射接口，无需继承特定基类型
interface MyEvents {
  'user:login': { userId: string; timestamp: number };
  'user:logout': { userId: string };
  'order:created': { orderId: string; amount: number };
}
```

### 创建实例

推荐使用工厂函数 `createEventHub`，也可直接 `new EventHub()`：

```ts
import { createEventHub } from '@nimble-api/eventhub';

const hub = createEventHub<MyEvents>();

// 或使用 EventHubOptions 自定义分隔符
const hub2 = createEventHub<MyEvents>({ delimiter: '/.' });
```

## 订阅方式对比

EventHub 提供 7 种订阅方式，按适用场景选择：

| 方法 | 触发次数 | 参数签名 | 适用场景 |
|------|:--:|------|------|
| `on(event, handler)` | 无限 | `(payload)` | 持久的业务逻辑监听 |
| `prependListener(event, handler)` | 无限 | `(payload)` | 需要优先执行的监听器 |
| `once(event, opts?)` | 1 次 | 返回 `Promise<payload>` | 等待某个一次性事件 |
| `prependOnceListener(event, handler)` | 1 次 | `(payload)` | 优先的一次性监听 |
| `many(event, n, handler)` | n 次 | `(payload)` | "前 N 次"模式，如新手引导步骤 |
| `onPattern(pattern, handler)` | 无限 | `(event, payload)` | 按命名空间批量监听，如 `order:*` |
| `onAny(handler)` | 无限 | `(event, payload)` | 全局日志、埋点、调试 |

## emit 模式对比

| 方法 | 执行方式 | 错误处理 | 返回 |
|------|------|------|------|
| `emit(event, payload)` | 同步并行 | 可配置：收集抛 `AggregateError`（默认）/ failFast / silent | `void` |
| `emitSerial(event, payload)` | 异步顺序 `await` | 遇错即停 | `Promise<void>` |
| `emitAsync(event, payload)` | 异步并行 | 不抛错，逐个查看 | `Promise<PromiseSettledResult[]>` |

> `emit()` 的错误策略通过 `EventHubOptions.emitMode` 配置，`emitSafety: 'fast'` 可跳过快照开销获得零分配性能。详见 [API 参考](./api)。

## 实际场景

### 防抖搜索输入

```ts
const hub = createEventHub<{ 'search:input': { query: string } }>();

// 方式一：options 传参
hub.on('search:input', ({ query }) => fetchResults(query), { debounce: 300 });

// 方式二：链式调用（等价写法）
hub.debounce(300).on('search:input', ({ query }) => fetchResults(query));

// 触发
inputEl.addEventListener('input', (e) => {
  hub.emit('search:input', { query: e.target.value });
});
```

### 节流滚动事件

```ts
const hub = createEventHub<{ 'scroll:progress': { pct: number } }>();

hub.on('scroll:progress', ({ pct }) => updateProgressBar(pct), { throttle: 100 });

window.addEventListener('scroll', () => {
  hub.emit('scroll:progress', { pct: computeProgress() });
});
```

### 通配符批量订阅

```ts
const hub = createEventHub<{
  'order:created': { orderId: string };
  'order:paid': { orderId: string };
  'order:shipped': { orderId: string };
  'user:login': { userId: string };
}>();

// * 匹配单段：order:created, order:paid, order:shipped，不匹配 order:items:updated
hub.onPattern('order:*', (event, payload) => {
  analytics.track(event, payload);
});

// ** 匹配多段：order:items:updated 也会匹配
hub.onPattern('order:**', (event, payload) => { /* ... */ });
```

### 结合 AbortController — React Hook

```ts
function useEvent<T extends EventMap, K extends keyof T & string>(
  hub: EventHub<T>,
  event: K,
  handler: (payload: T[K]) => void,
) {
  useEffect(() => {
    const controller = new AbortController();
    hub.on(event, handler, { signal: controller.signal });
    return () => controller.abort();
  }, [hub, event, handler]);
}
```

### 流式处理 — AsyncIterable

```ts
const hub = createEventHub<{ 'log:entry': { level: string; msg: string } }>();

// 在后台异步消费日志流
(async () => {
  for await (const entry of hub.events('log:entry')) {
    await sendToServer(entry);
  }
})();

// 任意位置发射
hub.emit('log:entry', { level: 'error', msg: 'connection lost' });
```

## 生命周期

EventHub 实例有两个层级的清理：

| 方法 | 效果 | 之后能否继续使用 |
|------|------|:---:|
| `clear()` | 移除所有监听器 | 是 |
| `dispose()` / `Symbol.dispose` | 销毁实例，禁止一切操作 | 否 |

```ts
// 使用 Symbol.dispose
{
  using hub = createEventHub();
  // ...
} // 自动调用 dispose()
```

## 内存泄漏检测

通过 `setMaxListeners` 设置上限，超出时在控制台收到警告：

```ts
hub.setMaxListeners(20);
// 若某个事件注册超过 20 个 handler，输出 MaxListenersExceededWarning
```
