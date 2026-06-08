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

## `prependOnceListener(event, handler, opts?)`

头部插入 + 一次性执行。handler 添加到队列头部，首次触发后自动取消订阅。

```ts
prependOnceListener<K>(event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions): Unsubscribe
```

```ts
hub.on('user:login', () => console.log('后执行'));
hub.prependOnceListener('user:login', () => console.log('仅一次，先执行'));

hub.emit('user:login', { userId: 'u1' });
// 输出：仅一次，先执行 → 后执行

hub.emit('user:login', { userId: 'u2' });
// 输出：后执行（prependOnceListener 已自动移除）
```

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

## `offAll(event?, handler?)`

移除指定事件的所有 handler，或移除该事件下某一 handler 的全部实例，或移除全部事件。

```ts
offAll(): void
offAll(event: K): void
offAll(event: K, handler: (payload: T[K]) => void): void
```

```ts
// 同一 handler 注册多次
hub.on('user:login', h);
hub.on('user:login', h);
hub.on('user:login', otherHandler);

hub.offAll('user:login', h); // 移除 h 的全部实例
hub.listeners('user:login'); // [otherHandler] — h 已全部移除
```

---

## `waitFor(event, opts?)`

`once()` 的别名，语义化 API，支持相同选项（`signal`、`timeout`、`filter`）。

```ts
waitFor<K>(event: K, opts?: { signal?: AbortSignal; timeout?: number; filter?: (payload: T[K]) => boolean }): Promise<T[K]>
```

---

## `events(event, opts?)`

返回 AsyncIterable，可 `for await...of` 流式消费事件。

```ts
events<K>(event: K, opts?: {
  signal?: AbortSignal;
  bufferMax?: number;
  bufferOverflow?: 'dropOldest' | 'dropNewest';
}): AsyncIterable<T[K]>
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bufferMax` | `number?` | `1000` | 最大缓冲事件数，0 表示无限制（慎用，可能导致内存泄漏） |
| `bufferOverflow` | `'dropOldest' \| 'dropNewest'` | `'dropOldest'` | Buffer 满时的策略：丢弃最旧（FIFO）或丢弃最新（保留历史快照） |

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

含通配符匹配的 handler（不含 `onAny` 的 catch-all handler，因其签名不同）。

---

## `rawListeners(event?)`

与 `listeners()` 相同，但返回 emit 时实际执行的函数（含 debounce/throttle 包装器），用于调试。

```ts
rawListeners<K>(event?: K): ((payload: T[K]) => void)[]
```

```ts
hub.on('user:login', handler, { throttle: 300 });
const orig = hub.listeners('user:login')[0];   // 用户传入的原始函数
const raw = hub.rawListeners('user:login')[0];  // emit 时实际调用的 throttled wrapper
console.log(orig === handler); // true
console.log(raw === handler);  // false — 含节流包装
```

---

## `hasListeners(event?)`

检查是否存在监听器。传事件名时检查直接 handler + 通配符匹配 + `onAny`。无参时检查是否有任何监听器。

```ts
hasListeners(event?: K): boolean
```

```ts
hub.hasListeners('user:login'); // false
hub.on('user:login', vi.fn());
hub.hasListeners('user:login'); // true
hub.hasListeners();             // true
hub.offAll();
hub.hasListeners();             // false
```

> `hasListeners(event)` 会检查 `onAny` 的存在（因为 `emit` 会调用它），而 `listeners(event)` 因类型签名限制无法在返回值中包含 `onAny`。

---

## `setMaxListeners(n)` / `getMaxListeners()`

设置/获取最大监听器数量限制。超出时的行为由 `EventHubOptions.maxListenersAction` 控制。
- 默认 `'warn'`：仅首次超出时 console.warn 一次，同一事件不重复警告
- `'throw'`：直接抛错
- `'silent'`：静默忽略
- 自定义回调 `(event, count) => void`：**每次超出都调用**，不做去重

```ts
setMaxListeners(n: number): void
getMaxListeners(): number
```

```ts
hub.setMaxListeners(50);

// 可通过 maxListenersAction 配置行为
const hub = createEventHub({
  maxListenersAction: 'throw',                 // 超出直接抛错
  // maxListenersAction: 'silent',             // 静默忽略
  // maxListenersAction: (event, count) => {   // 自定义回调
  //   logger.warn(`Leak: ${count} on ${event}`);
  // },
});
hub.setMaxListeners(3);
```

---

## `debounce(ms)` / `throttle(ms, opts?)` — 流控链

链式调用为 handler 添加防抖/节流，作用等同于 `SubscribeOptions` 中的同名参数。同时设置时 `throttle` 优先生效。

```ts
debounce(ms: number): { on, onPattern, onAny }
throttle(ms: number, opts?: { edge?: 'both' | 'leading' | 'trailing' }): { on, onPattern, onAny }
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `edge` | `'both' \| 'leading' \| 'trailing'` | `'both'` | throttle 发射边策略 |

```ts
// 链式写法 — 输入框中输入停止 300ms 后触发搜索
input.addEventListener('input', (e) => {
  hub.debounce(300).on('search:input', () => search(e.target.value));
});

// leading-only — 按钮防重复点击
hub.throttle(500, { edge: 'leading' }).on('submit', handleSubmit);

// trailing-only — resize 只关心最终状态
hub.throttle(200, { edge: 'trailing' }).on('resize', handleResize);

// 等价于 options 写法
hub.on('search:input', () => search(e.target.value), { debounce: 300 });
```

---

## `EventHubOptions`

构造 EventHub 实例时可传入的可选配置。

```ts
interface EventHubOptions {
  delimiter?: string;
  metaMode?: 'smart' | 'full' | 'lean' | 'simple';
  emitMode?: 'aggregate' | 'failFast' | 'silent';
  emitSafety?: 'safe' | 'fast';
  maxListenersAction?: 'warn' | 'throw' | 'silent' | ((event: string, count: number) => void);
}
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `delimiter` | `string?` | `':./'` | 用于 `onPattern` glob 匹配的分隔符 |
| `metaMode` | `'smart' \| 'full' \| 'lean' \| 'simple'` | `'smart'` | 移除监听时 meta 事件的 handler 携带策略 |
| `emitMode` | `'aggregate' \| 'failFast' \| 'silent'` | `'aggregate'` | 同步 `emit()` 的 handler 错误处理策略（仅影响 `emit`，不影响 `emitSerial`/`emitAsync`） |
| `emitSafety` | `'safe' \| 'fast'` | `'safe'` | handler 迭代模式：safe=快照（emit 中增删不影响当前循环），fast=直接迭代（零分配） |
| `maxListenersAction` | `'warn' \| 'throw' \| 'silent' \| callback` | `'warn'` | 超出 `maxListeners` 时的行为 |

### metaMode 详解

| 模式 | 单次移除 (`off`, `unsub`) | 批量移除 (`offAll`) |
|------|------|------|
| `smart` (默认) | `{ event, handler }` | `{ event }` 一次，不带 handler |
| `full` | `{ event, handler }` | `{ event, handler }` 逐条遍历 |
| `lean` | `{ event }` | `{ event }` 一次，不带 handler |
| `simple` | 不触发 meta 事件 | 不触发 meta 事件 |

### emitMode 详解

| 模式 | 行为 |
|------|------|
| `aggregate` (默认) | 收集所有 handler 错误，最后抛 `AggregateError` |
| `failFast` | 第一个错误立刻抛出，停止后续 handler |
| `silent` | 忽略所有 handler 错误 |

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

EventHub 内部维护四个元事件，分事前和事后两类：

| 元事件 | 时机 | Payload | 抛错行为 |
|------|------|------|------|
| `beforeListenerAdd` | 添加 handler **之前** | `{ event: string; handler: Function }` | 错误穿透，阻止添加 |
| `listenerAdded` | 添加 handler **之后** | `{ event: string }` | 静默忽略 |
| `beforeListenerRemove` | 移除 handler **之前** | `{ event: string; handler?: Function }` | 错误穿透，阻止移除 |
| `listenerRemoved` | 移除 handler **之后** | `{ event: string }` | 静默忽略 |

> 事前事件抛错可阻止操作；事后事件错误被静默忽略（操作已完成）。`handler` 字段在批量移除时（`offAll(event)`）为 `undefined`，具体行为由 `metaMode` 控制。元事件不会被 `onAny` / `onPattern` 接收，也不触发自身的元事件（防递归）。

```ts
// 使用事前事件做访问控制
hub.on('beforeListenerAdd', ({ event }) => {
  if (event.startsWith('admin:')) throw new Error('Forbidden');
});
hub.on('admin:secret', handler); // 抛出 — handler 未添加

// 调试 — 记录所有订阅生命周期
hub.on('listenerAdded', ({ event }) => console.log(`+ ${event}`));
hub.on('listenerRemoved', ({ event }) => console.log(`- ${event}`));
```

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
