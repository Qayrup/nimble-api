# EventHub 类型定义

## `EventMap`

基础映射类型，所有自定义事件映射需 extend 此类型。

```ts
export type EventMap = Record<string, unknown>;
```

使用示例：

```ts
interface MyEvents extends EventMap {
  'user:login': { userId: string };
  'user:logout': { userId: string };
  'order:created': { orderId: string; amount: number };
}
```

---

## `SubscribeOptions`

`on()` / `onAny()` 的可选参数。

```ts
export interface SubscribeOptions {
  signal?: AbortSignal;
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `signal` | `AbortSignal?` | 取消信号，abort 时自动取消订阅 |

---

## `Unsubscribe`

`on()` / `onAny()` 返回的取消订阅函数。

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
