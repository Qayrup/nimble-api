# EventHub API 参考

## `on(event, handler, opts?)`

订阅事件，返回取消订阅函数。

```ts
on<K>(event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

**参数：**
- `event` — 事件名（来自 EventMap 的 key）
- `handler` — 事件处理函数，接收类型匹配的 payload
- `opts.signal` — AbortSignal，abort 时自动取消订阅

**返回：** `Unsubscribe` — 无参函数，调用即取消订阅

```ts
const unsub = hub.on('user:login', (payload) => {
  console.log(payload.userId);
});

// 通过 AbortSignal 取消
const controller = new AbortController();
hub.on('user:login', handler, { signal: controller.signal });
controller.abort(); // 自动取消订阅
```

---

## `onAny(handler, opts?)`

订阅所有事件，handler 第一个参数是事件名，第二个是载荷。

```ts
onAny(handler: (event: K, payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

```ts
hub.onAny((event, payload) => {
  console.log(`事件 "${event}" 触发`, payload);
});
```

---

## `once(event, opts?)`

一次性监听，返回 Promise，事件触发后自动取消订阅。

```ts
once<K>(event: K, opts?: { signal?: AbortSignal; timeout?: number }): Promise<T[K]>
```

**参数：**
- `opts.timeout` — 超时（ms），超时抛出 `TimeoutError`
- `opts.signal` — abort 时抛出 `AbortError`

```ts
// 超时等待
try {
  const payload = await hub.once('user:login', { timeout: 5000 });
} catch (err) {
  // TimeoutError
}
```

---

## `emit(event, payload)`

异步发射事件（并行调用所有 handler），捕获每个 handler 的错误并以 `AggregateError` 抛出。

```ts
emit<K>(event: K, payload: T[K]): Promise<void>
```

快照安全：emit 过程中增删监听器不影响当前发射周期的 handler 集合。

```ts
await hub.emit('user:login', { userId: 'u1', timestamp: Date.now() });
```

---

## `emitSerial(event, payload)`

顺序发射事件，`await` 每个 handler 完成后再调用下一个。遇到第一个错误即停止（不会收集）。

```ts
emitSerial<K>(event: K, payload: T[K]): Promise<void>
```

适用于需要严格顺序执行的场景（如状态机状态变更）。

---

## `off(event, handler)`

移除指定事件的指定 handler。需要传入与 `on()` 时相同的函数引用。

```ts
off<K>(event: K, handler: (payload: T[K]) => void): void
```

---

## `offAll(event?)`

移除指定事件的所有 handler，或移除全部事件。

```ts
offAll(event?: K): void
```

---

## `waitFor(event, opts?)`

`once()` 的别名，语义化 API。

```ts
waitFor<K>(event: K, opts?: { signal?: AbortSignal; timeout?: number }): Promise<T[K]>
```

---

## `events(event, opts?)`

返回 AsyncIterable，可 `for await...of` 流式消费事件。

```ts
events<K>(event: K, opts?: { signal?: AbortSignal }): AsyncIterable<T[K]>
```

```ts
for await (const payload of hub.events('order:created')) {
  // payload 类型为 MyEvents['order:created']
  console.log('新订单:', payload.orderId);
}

// 配合 AbortSignal 终止迭代
const controller = new AbortController();
setTimeout(() => controller.abort(), 60000);

for await (const payload of hub.events('order:created', { signal: controller.signal })) {
  // 60 秒后自动终止
}
```

---

## `listenerCount(event?)`

返回指定事件的监听器数量，省略参数返回总数。

```ts
listenerCount(event?: K): number
```

---

## `eventNames()`

返回所有已注册事件名。

```ts
eventNames(): (keyof T & string)[]
```

---

## `clear()`

移除所有监听器，实例保持可用。

```ts
clear(): void
```

---

## `dispose()`

销毁实例，移除所有监听器，后续操作抛出错误。

```ts
dispose(): void
```

---

## `[Symbol.dispose]()`

实现 `Explicit Resource Management` 提案，支持 `using` 语法。

```ts
{
  using hub = createEventHub();
  hub.on('user:login', handler);
} // 作用域结束自动调用 dispose()
```

---

## 元事件 (Meta Events)

EventHub 内部维护两个元事件，handler 抛出的错误被静默忽略：

- `listenerAdded` — 添加监听器时触发，payload: `{ event: string }`
- `listenerRemoved` — 移除监听器时触发，payload: `{ event: string }`

仅在事件名有至少一个监听器时才发射元事件，避免无意义的开销。
