# EventHub 概述

`@nimble-api/eventhub` 是一个轻量级的 TypeScript 事件管理器，零外部依赖，提供完整类型推导的事件订阅与派发能力。

## 设计理念

- **类型安全** — 通过 `EventMap` 泛型约束事件名与载荷类型，编译期即可发现错误
- **O(1) 查找** — 底层使用 `Map<string, Set<HandlerRecord>>` 实现，查找复杂度 O(1)
- **快照安全** — `emit()` 期间增删监听器不影响当前发射周期
- **多范式** — 支持回调订阅、Promise 一次性、AsyncIterable 流式消费

## 核心概念

### EventMap

所有事件类型通过 `EventMap` 接口定义，K 为事件名，V 为载荷类型：

```ts
import { type EventMap } from '@nimble-api/eventhub';

interface MyEvents extends EventMap {
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
