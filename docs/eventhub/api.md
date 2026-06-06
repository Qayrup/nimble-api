# EventHub API 参考

## `on(event, handler, opts?)`

订阅事件，返回取消订阅函数。

```ts
on<K>(event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

**参数：**
- `event` — 事件名（来自 EventMap 的 key）
- `handler` — 事件处理函数，接收类型匹配的 payload。非 function 类型抛出 `TypeError`
- `opts.signal` — AbortSignal，abort 时自动取消订阅
- `opts.debounce` — 防抖（ms）
- `opts.throttle` — 节流（ms）

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

## `prependListener(event, handler, opts?)`

与 `on()` 相同，但 handler 添加到队列头部，优先于已注册的 handler 执行。

```ts
prependListener<K>(event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

```ts
hub.on('user:login', () => console.log('后注册'));
hub.prependListener('user:login', () => console.log('先执行'));

hub.emit('user:login', { userId: 'u1' });
// 输出：先执行 → 后注册
```

> `prependListener` 完全支持 `debounce` 和 `throttle` 选项，与 `on()` 行为一致。

---

## `many(event, n, handler, opts?)`

监听恰好 n 次后自动取消订阅。

```ts
many<K>(event: K, n: number, handler: (payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

```ts
hub.many('user:login', 3, (payload) => {
  console.log('登录:', payload.userId);
});
// handler 执行 3 次后自动取消
```

---

## `onPattern(pattern, handler, opts?)`

基于 glob 模式的通配符订阅。匹配的事件触发时，handler 接收事件名和载荷两个参数。

```ts
onPattern(pattern: string, handler: (event: string, payload: T[keyof T]) => void, opts?: SubscribeOptions): Unsubscribe
```

分隔符默认为 `:./`，可通过 `EventHubOptions.delimiter` 自定义。

```ts
hub.onPattern('user:*', (event, payload) => {
  console.log(`事件 "${event}" 匹配到 user:*`, payload);
});

hub.emit('user:login', { userId: 'u1' });    // 匹配
hub.emit('user:logout', { userId: 'u1' });   // 匹配
hub.emit('user:login:success', {});          // 不匹配 — * 只匹配单段

// ** 匹配多段
hub.onPattern('user:**', () => {}); // 匹配 user:login, user:login:success
hub.emit('order:created', { orderId: 'o1' }); // 不匹配
```

---

## `once(event, opts?)`

一次性监听，返回 Promise，事件触发后自动取消订阅。

```ts
once<K>(event: K, opts?: { signal?: AbortSignal; timeout?: number; filter?: (payload: T[K]) => boolean }): Promise<T[K]>
```

**参数：**
- `opts.timeout` — 超时（ms），超时抛出 `TimeoutError`
- `opts.signal` — abort 时抛出 `AbortError`
- `opts.filter` — 过滤函数，仅匹配时 resolve

```ts
// 超时等待
try {
  const payload = await hub.once('user:login', { timeout: 5000 });
} catch (err) {
  // TimeoutError
}

// 带过滤条件的一次性监听
const payload = await hub.once('order:created', {
  filter: (p) => p.amount > 100,
});
```

---

## `emit(event, payload)`

同步发射事件（并行调用所有 handler），捕获每个 handler 的错误并以 `AggregateError` 抛出。

```ts
emit<K>(event: K, payload: T[K]): void
```

快照安全：emit 过程中增删监听器不影响当前发射周期的 handler 集合。

```ts
hub.emit('user:login', { userId: 'u1', timestamp: Date.now() });
```

---

## `emitSerial(event, payload)`

顺序发射事件，`await` 每个 handler 完成后再调用下一个。遇到第一个错误即停止（不会收集）。

```ts
emitSerial<K>(event: K, payload: T[K]): Promise<void>
```

适用于需要严格顺序执行的场景（如状态机状态变更）。

---

## `emitAsync(event, payload)`

并行异步发射事件，返回 `Promise.allSettled` 结果数组。不抛出错误，每个 handler 的结果独立查看。

```ts
emitAsync<K>(event: K, payload: T[K]): Promise<PromiseSettledResult<unknown>[]>
```

```ts
const results = await hub.emitAsync('order:created', { orderId: 'o1' });
for (const r of results) {
  if (r.status === 'rejected') console.error(r.reason);
}
```

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
events<K>(event: K, opts?: { signal?: AbortSignal; bufferMax?: number }): AsyncIterable<T[K]>
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bufferMax` | `number?` | `1000` | 最大缓冲事件数，超出时丢弃最旧事件 |

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

## `listeners(event?)`

返回指定事件的全部 handler 数组，省略参数返回全部事件的 handler。

```ts
listeners<K>(event?: K): ((payload: T[K]) => void)[]
```

含通配符匹配的 handler。

---

## `setMaxListeners(n)` / `getMaxListeners()`

设置/获取最大监听器数量限制。超出限制时发出控制台警告（仅首次）。

```ts
setMaxListeners(n: number): void
getMaxListeners(): number
```

```ts
hub.setMaxListeners(50);
```

---

## `debounce(ms)` / `throttle(ms)` — 流控链

链式调用为 handler 添加防抖/节流，作用等同于 `SubscribeOptions` 中的同名参数。同时设置时 `throttle` 优先生效。

```ts
debounce(ms: number): { on, onPattern, onAny }
throttle(ms: number): { on, onPattern, onAny }
```

```ts
// 链式写法 — 输入框中输入停止 300ms 后触发搜索
input.addEventListener('input', (e) => {
  hub.debounce(300).on('search:input', () => search(e.target.value));
});

// 等价于 options 写法
hub.on('search:input', () => search(e.target.value), { debounce: 300 });
```

---

## `EventHubOptions`

构造 EventHub 实例时可传入的可选配置。

```ts
interface EventHubOptions {
  delimiter?: string; // 用于 onPattern 的 glob 分隔符，默认 ':./'
}
```

```ts
// 自定义分隔符
const hub = new EventHub({ delimiter: '/.' });
hub.onPattern('user/*', handler);
hub.emit('user/login', {}); // 匹配
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

---

## 常见模式速查

### 等待 UI 交互结果

```ts
// 弹窗确认 → 返回用户选择
const showDialog = (msg: string) => {
  hub.emit('dialog:show', { message: msg });
  return hub.once('dialog:confirm', { timeout: 30000 });
};

const result = await showDialog('确定删除？');
```

### 事件日志 / 调试

```ts
hub.onAny((event, payload) => {
  console.debug(`[${new Date().toISOString()}] ${event}`, payload);
});
```

### 全局错误边界

```ts
hub.onPattern('**:error', (event, payload) => {
  reportToSentry(event, payload);
});
```

### 钩子生命周期管理

```ts
type Lifecycle = { 'plugin:init': void; 'plugin:destroy': void };
const lifecycle = createEventHub<Lifecycle>();

// 触发时自动清理
const controller = new AbortController();
lifecycle.on('plugin:init', setup, { signal: controller.signal });
lifecycle.on('plugin:destroy', () => controller.abort());
```
