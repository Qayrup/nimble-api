# qayrup-api

轻量级 API 服务框架，支持声明式 API 定义、动态方法生成、请求缓存、去重、以及可组合的优化策略（防抖/节流/锁）。

## 安装

```bash
npm install qayrup-api
```

依赖 `qayrup-eventhub`，事件总线需通过 `initApiService` 自动连接或手动调用 `setEventBus`。

## 快速开始

### 基础用法

```ts
import { createApiService } from 'qayrup-api';

const api = createApiService({
  getUser: {
    url: '/api/user/{userId}',
    method: 'GET',
    eventSuccess: ['USER:FETCHED'],
    eventErrors: {
      default: 'USER:ERROR',
      404: 'USER:NOT_FOUND'
    }
  },
  updateUser: {
    url: '/api/user/{userId}',
    method: 'POST',
    eventSuccess: ['USER:UPDATED'],
    eventErrors: { default: 'USER:UPDATE_ERROR' }
  }
});

// 通过代理自动生成 API 方法 —— 属性名加 API 后缀
const user = await api.getUserAPI({ userId: '123' });

// 带缓存的请求（需配置 cacheTTL）
const cached = await api.getUserAPI({ userId: '123' }, {});
```

### 单例模式（自动连接事件总线）

```ts
import { initApiService } from 'qayrup-api';

const api = initApiService({
  getList: {
    url: '/api/list',
    eventSuccess: ['LIST:LOADED'],
    eventErrors: { default: 'LIST:ERROR' }
  }
});

// 后续获取
import { getApiService } from 'qayrup-api';
const sameInstance = getApiService();
```

### 链式优化器

```ts
import { OPTIMIZE_TYPES } from 'qayrup-api';

const api = createApiService({
  search: {
    url: '/api/search',
    eventSuccess: ['SEARCH:DONE'],
    eventErrors: { default: 'SEARCH:ERROR' }
  }
});

// optimize() 链式调用，返回的代理对象可继续访问 API 方法
const debouncedSearch = api
  .optimize(OPTIMIZE_TYPES.DEBOUNCE, 300)
  .searchAPI;

// 也可以用 LINKAPI 后缀
const lockedSubmit = api
  .optimize(OPTIMIZE_TYPES.SWITCH_LOCK)
  .submitLINKAPI;
```

## API 配置（ApiConfig）

每个 API 端点通过 key 定义，配置结构如下：

```ts
interface ApiConfigItem {
  url: string;                              // 请求 URL，支持 {param} 占位符
  method?: string;                          // HTTP 方法，默认 GET，支持 UPLOAD
  headers?: Record<string, string>;         // 自定义请求头
  cacheTTL?: number;                        // 缓存有效期（ms），不设则不走缓存
  eventSuccess: string[];                   // 成功时触发的事件键列表
  eventErrors: {
    default: string;                        // 默认错误事件键（必填）
    [code: string]: string;                 // 按错误码分发不同事件
  };
}
```

示例：

```ts
const config = {
  uploadFile: {
    url: '/api/upload',
    method: 'UPLOAD',       // 特殊方法：走 uni.uploadFile
    eventSuccess: ['FILE:UPLOADED'],
    eventErrors: { default: 'FILE:ERROR' }
  },
  getDetail: {
    url: '/api/detail/{id}',
    method: 'GET',
    cacheTTL: 60000,        // 60 秒缓存
    eventSuccess: ['DETAIL:LOADED'],
    eventErrors: {
      default: 'DETAIL:ERROR',
      404: 'DETAIL:NOT_FOUND'
    }
  }
};
```

## 代理属性约定

| 属性后缀 | 行为 |
|----------|------|
| `xxxAPI` | 返回 API 方法，方法不存在时自动懒编译 |
| `xxxLINKAPI` | 返回带有 `.optimize()` 链式支持的 API 方法（带缓存） |

```ts
// 等价调用
const m1 = api.getUserAPI;    // 代理自动解析
const m2 = api.getAPIMethod('getUser');  // 显式获取
const m3 = api.getUserLINKAPI;  // 带 optimize 链式支持
```

## 优化策略

通过 `OPTIMIZE_TYPES` 常量选择策略，支持组合链式调用。

| 优化类型 | 常量 | 说明 |
|----------|------|------|
| 防抖 | `DEBOUNCE` | 连续调用只执行最后一次，前序未完成的 Promise 自动拒绝 |
| 节流 | `THROTTLE` | 窗口期内调用返回同一个 Promise |
| 开关锁 | `SWITCH_LOCK` | 上锁期间后续调用直接返回 `null` |
| 链路锁 | `LINK_LOCK` | 上锁期间后续调用抛出错误 |
| 返回值控制 | `RETURN_CONTROL` | 控制是否返回结果 |
| 防抖+节流 | `DEBOUNCE_THROTTLE` | 先防抖后节流，组合使用 |

### 优化器参数

```ts
// 防抖：第二个参数为延迟时间（ms），默认 3000
api.optimize(OPTIMIZE_TYPES.DEBOUNCE, 500).submitAPI(params);

// 节流：第二个参数为窗口时间（ms），默认 300
api.optimize(OPTIMIZE_TYPES.THROTTLE, 200).scrollAPI(params);

// 开关锁：可传入共享的锁对象
const sharedLock = { value: false };
api.optimize(OPTIMIZE_TYPES.SWITCH_LOCK, sharedLock).criticalAPI();

// 链路锁：可传入共享的锁对象
api.optimize(OPTIMIZE_TYPES.LINK_LOCK, sharedLock).sequentialAPI();
```

### 链式组合

```ts
// 先防抖再节流
api
  .optimize(OPTIMIZE_TYPES.DEBOUNCE_THROTTLE, 300)
  .searchAPI({ query: 'hello' });
```

## 请求流程

1. **URL 构建**：根据配置中的 `{param}` 占位符和传入 `params` 拼接完整 URL
2. **缓存检查**：若配置了 `cacheTTL`，先查缓存 → 再查 in-flight 去重
3. **请求去重**：同 cacheKey 的并发请求共享同一个 Promise
4. **发送请求**：UniApp 环境使用 `uni.request`/`uni.uploadFile`；非 UniApp 环境回退到 `fetch`
5. **事件派发**：成功/失败事件通过微任务批量合并后发送到 `qayrup-eventhub`
6. **缓存写入**：成功响应（code=200）且配置了 `cacheTTL` 时自动缓存

## 缓存系统

- **缓存键生成**：`apiKey:paramsHash:dataHash`，使用 FNV-1a 哈希
- **键稳定性**：对象 key 排序 + 特殊值规范化（`undefined` → `__undefined__`、`NaN` → `__NaN__`、循环引用 → `__CIRCULAR_REF__`）
- **TTL 过期**：定时器到期自动清除
- **In-flight 去重**：同一 cacheKey 的并发请求复用已有 Promise

```ts
const api = createApiService({
  getUser: {
    url: '/api/user/{id}',
    cacheTTL: 30000,  // 30 秒
    eventSuccess: ['USER:DONE'],
    eventErrors: { default: 'USER:ERROR' }
  }
});

// 首次请求走网络
const r1 = await api.getUserAPI({ id: '1' });
// 30 秒内再次请求走缓存
const r2 = await api.getUserAPI({ id: '1' }); // 命中缓存
```

## 配置项（ApiSettings）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableLogging` | `boolean` | `false` | 是否启用日志输出 |
| `fetchTimeout` | `number` | `30000` | 请求超时时间（ms），非 UniApp 环境生效 |

## API 参考

### 工厂函数

#### createApiService(apiConfig?, settings?)

创建新的 `ApiService` 实例，返回 Proxy 包装。

```ts
const api = createApiService({ ...config }, { fetchTimeout: 10000 });
```

#### initApiService(apiConfig?, settings?)

初始化单例，自动连接 `qayrup-eventhub`。

#### getApiService()

获取已初始化的单例实例，未初始化时抛出错误。

### ApiService 实例方法

| 方法 | 说明 |
|------|------|
| `getAPIMethod(apiKey)` | 获取或懒编译指定 API 方法 |
| `getAPIMethodLink(apiKey)` | 获取带 `.optimize()` 链式支持的 API 方法（带缓存） |
| `optimize(type, ...args)` | 创建优化器代理，返回对象可链式访问 API 方法 |
| `precompileMethods()` | 预编译所有 API 方法（避免懒编译的性能开销） |
| `destroy()` | 销毁实例，清理定时器、缓存、请求状态、事件队列 |

### 事件总线集成

```ts
import { setEventBus } from 'qayrup-api';
import { createAdvancedEvent } from 'qayrup-eventhub';

const bus = createAdvancedEvent({ USER: { FETCHED: '' } });
setEventBus(bus);

// API 成功后 bus 自动收到 USER:FETCHED 事件
```

事件在微任务中批量合并派发：多次请求的结果先入队，同事件键的 payload 合并后统一派发，避免高频事件风暴。

## 架构概览

```
src/
├── index.ts                         # 入口：工厂函数、单例、代理
└── esm/
    ├── apiService/
    │   ├── apiService.ts            # ApiService 核心（动态方法生成、代理）
    │   ├── baseApi.ts               # BaseApi（请求执行、缓存、事件派发）
    │   ├── optimizers.ts            # 优化器（防抖/节流/锁/返回值控制）
    │   └── cacheKeyGenerator.ts     # 缓存键生成（FNV-1a 哈希、对象规范化）
    └── optimizers/
        └── constants.ts             # OPTIMIZE_TYPES 常量
```

### 核心流程

1. **构造阶段**：传入 `ApiConfig` → `ApiService` 继承 `BaseApi`，初始化缓存 Map、锁 Map 等状态
2. **方法生成**：首次访问 `xxxAPI` → 代理拦截 → `_createCompiledMethod` → 提取 URL 占位符 → 生成 `urlBuilder` + `makeRequest` 闭包
3. **请求阶段**：`makeRequest` → 缓存检查 → in-flight 去重 → 发送请求（UniApp / fetch）→ 响应处理 → 事件入队 → 微任务批量派发
4. **优化链**：`optimize(type)` → 返回代理对象 → 访问 `.xxxAPI` 时自动调用 `applyOptimization` 包装原始方法
5. **销毁阶段**：`destroy()` → 清理缓存定时器、防抖定时器、请求状态、事件队列

## License

ISC
