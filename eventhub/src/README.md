# qayrup-eventhub

一个轻量级、功能丰富的事件管理器，支持流量控制（防抖/节流）、命名空间批量订阅、性能监控等高级特性。

## 安装

```bash
npm install qayrup-eventhub
```

## 快速开始

### 基础用法

```ts
import { createAdvancedEvent } from 'qayrup-eventhub';

// 创建实例，第一个参数定义事件键结构，第二个参数为配置项
const bus = createAdvancedEvent(
  { user: { login: '', logout: '' } },
  { enabled: false }
);

// 注册事件监听
bus.on('user:login', (username: string) => {
  console.log(`${username} 登录成功`);
});

// 触发事件
bus.emit('user:login', 'Alice');
```

### 单例模式

```ts
import { initAdvancedEvent } from 'qayrup-eventhub';

// 首次调用创建实例，后续调用返回同一实例
const bus = initAdvancedEvent(
  { app: { ready: '' } },
  { enabled: true }
);
```

### 默认导出（代理模式）

```ts
import eventHub from 'qayrup-eventhub';

// 使用前需先调用 initAdvancedEvent() 初始化单例
eventHub.on('app:ready', () => {});
eventHub.emit('app:ready');
```

## 事件键（Event Key）

事件键由嵌套对象定义，通过冒号 `:` 连接路径层级，形成如 `user:login`、`user:logout` 的事件标识。

```ts
const bus = createAdvancedEvent({
  user: {
    login: '',
    logout: '',
    profile: {
      update: '',
      delete: ''
    }
  }
});

// 生成的事件键: user:login, user:logout, user:profile:update, user:profile:delete
console.log(bus.getEvenKey());
```

### 内置事件

框架内置 `BUILT.ERROR` 命名空间，包含以下错误事件：

| 事件键 | 说明 |
|--------|------|
| `BUILT:ERROR:LISTENER_OVERFLOW` | 监听器超出上限 |
| `BUILT:ERROR:LISTENER_REPEAT` | 监听器重复注册 |
| `BUILT:ERROR:HANDLER_ILLEGAL` | 非法处理器 |
| `BUILT:ERROR:DEFAULT` | 默认错误 |
| `BUILT:ERROR:TEST` | 测试用 |

## API 参考

### AdvancedEventEmitter

#### on(eventType, handler, config?)

注册事件监听器。当 `eventType` 是路径前缀时，自动匹配该命名空间下所有子事件。

```ts
// 单事件注册
bus.on('user:login', (username: string) => {
  console.log(username);
});

// 配置选项
bus.on('user:login', handler, {
  mode: 'debounce',  // 流量控制模式
  timing: 300,        // 防抖/节流延迟（ms）
  once: true          // 仅执行一次
});

// 命名空间批量注册 —— 匹配 user 下所有事件
bus.on('user', (payload) => {
  console.log('user 命名空间下任意事件触发');
});
```

#### onKey(eventType, handler, config?)

精确事件注册，不进行命名空间匹配。

#### onAll(eventType, handler, config?)

显式命名空间批量注册，匹配 `eventType` 前缀下所有已注册事件。

#### emit(eventType, ...payload)

触发事件，向所有匹配的监听器传递参数。

```ts
bus.emit('user:login', 'Alice', { ip: '127.0.0.1' });
```

#### off(eventType, handler)

移除事件监听器。当 `eventType` 为路径前缀时，批量移除该命名空间下的监听器。

```ts
bus.off('user:login', handler);   // 移除单个
bus.off('user', handler);          // 移除 user 命名空间下所有匹配
```

#### offKey(eventType, handler)

精确移除指定事件的监听器。

#### offAll(eventType, handler)

批量移除命名空间下的监听器。

#### getEvenKey()

获取只读的事件键对象。

```ts
const keys = bus.getEvenKey();
// => { user: { login: 'user:login', ... }, BUILT: { ERROR: { ... } } }
```

#### setListenerLimit(limit)

设置单个事件的最大监听器数量（默认 200，最小 1）。

```ts
bus.setListenerLimit(50);
```

#### setDeBug(fn)

自定义错误处理函数（必须是抛出异常的函数）。

```ts
bus.setDeBug((msg, eventType, handler) => {
  throw new Error(`[${eventType}] ${msg}`);
});
```

#### getMetrics(eventType)

获取指定事件的性能指标（需在配置中启用 `enabled: true`）。

```ts
const metrics = bus.getMetrics('user:login');
// => { calls: 42, avg: 1.5, max: 12, total: 63 }
```

#### destroy()

销毁实例，清理所有监听器、定时器和状态。

```ts
bus.destroy();
```

### 工厂函数

#### createAdvancedEvent(eventConfig?, settings?)

创建新的 `AdvancedEventEmitter` 实例。

```ts
const bus = createAdvancedEvent(
  { myEvent: '' },
  { strictMode: true }
);
```

#### initAdvancedEvent(eventConfig?, settings?)

初始化单例，重复调用返回同一实例。

```ts
const bus = initAdvancedEvent({ app: { load: '' } });
```

## 流量控制

### 防抖（Debounce）

连续触发事件时，只有最后一次触发后等待指定延迟才执行。

```ts
bus.on('search:input', (query: string) => {
  fetch(`/api/search?q=${query}`);
}, { mode: 'debounce', timing: 300 });
```

### 节流（Throttle）

固定时间间隔内最多执行一次。

```ts
bus.on('scroll:position', (pos: { x: number; y: number }) => {
  updateScrollIndicator(pos);
}, { mode: 'throttle', timing: 150 });
```

`mode` 支持简写：`'d'` = 防抖，`'t'` = 节流。

## 配置项（EventHubSettings）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableAsyncHandling` | `boolean` | `true` | 是否自动包装异步处理器错误 |
| `strictMode` | `boolean` | `false` | 严格模式 —— 未注册事件触发时报错 |
| `maxListeners` | `number` | `200` | 单事件最大监听器数 |
| `maxNamespaceBatchSize` | `number` | `500` | 命名空间批量注册上限 |
| `defaultThrottle` | `number` | `150` | 默认节流延迟（ms） |
| `defaultDebounce` | `number` | `250` | 默认防抖延迟（ms） |
| `enabled` | `boolean` | `false` | 是否启用性能监控 |

## 架构概览

```
src/
├── index.ts                     # 入口：工厂函数、单例、代理
└── esm/
    ├── index.ts                 # AdvancedEventEmitter 核心类
    ├── flowController.ts        # 防抖/节流流量控制器
    ├── PathPrefixMatcher.ts     # 路径前缀匹配器（命名空间支持）
    ├── objectTransformation.ts  # 对象 ↔ 字符串数组互转
    ├── validate.ts              # 参数校验工具
    ├── utils.ts                 # 工具函数（时间、去重、删除等）
    ├── BuiltEvent.ts            # 内置事件常量
    ├── executionError.ts        # 错误处理管道
    └── performanceMonitor.ts    # 性能监控模块
```

### 核心流程

1. **构造阶段**：用户传入事件配置对象 → `safeObjectsToStrings` 转为路径数组 → `stringsToObject` 构建 `EVENTKEY` → `initializeEventRegistry` 初始化 `Map<事件名, Set<处理器>>`
2. **注册阶段**：`on()` → 校验事件键和处理器 → 判断是否为命名空间前缀 → 进入 `onKey`（精确匹配）或 `onAll`（批量注册）→ 应用包装器（防抖/节流/once）
3. **触发阶段**：`emit()` → 查找匹配的处理器集合 → 逐个执行 → 记录性能指标
4. **销毁阶段**：`destroy()` → 清理所有定时器 → 清空监听器 Map → 清空前缀匹配器

## License

ISC
