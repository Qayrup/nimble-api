# 钩子系统

钩子系统提供请求生命周期的 4 个拦截点，每个钩子接收和返回 `RequestState`，可以修改任何字段。

## 钩子类型

```ts
type BeforeRequestHook = (state: RequestState) => RequestState | Promise<RequestState>;
type AfterResponseHook = (state: RequestState) => RequestState | Promise<RequestState>;
type BeforeRetryHook = (state: RequestState) => RequestState | Promise<RequestState> | typeof stop;
type BeforeErrorHook = (state: RequestState) => RequestState | Promise<RequestState>;
```

## 配置方式

```ts
const api = createApiClient({
  hooks: {
    beforeRequest: [hook1, hook2],
    afterResponse: [hook3],
    beforeRetry: [hook4],
    beforeError: [hook5],
  },
});
```

`extend()` 创建的客户端会合并父客户端的钩子（父钩子先执行）。

---

## beforeRequest

在发送请求前执行。可修改 URL、headers、body 等。

```ts
const authHook: BeforeRequestHook = (state) => {
  state.request.headers['Authorization'] = `Bearer ${getToken()}`;
  return state;
};
```

执行顺序：正向遍历数组。

---

## afterResponse

在收到响应后执行（仅在状态码 2xx 时）。可修改响应数据。

```ts
const transformHook: AfterResponseHook = (state) => {
  // state.response.data 已通过 schema 校验
  state.response!.data = {
    ...state.response!.data,
    _fetchedAt: Date.now(),
  };
  return state;
};
```

执行顺序：**逆序**遍历数组（类似 Koa 洋葱模型的后半段）。

---

## beforeRetry

在准备重试前执行。返回 `stop` symbol 可中止重试。

```ts
const rateLimitHook: BeforeRetryHook = (state) => {
  if (state.error?.status === 429) {
    console.log('限流错误，等待后重试...');
    return state;
  }
  if (state.error?.status === 401) {
    return stop; // 认证失败，不重试
  }
  return state;
};
```

执行顺序：正向遍历，任一钩子返回 `stop` 立即中止。

---

## beforeError

在请求失败后执行（包含 afterResponse 钩子执行期间的异常）。可在错误上附加额外信息后重新抛出。

```ts
const loggingHook: BeforeErrorHook = (state) => {
  console.error('请求失败', {
    url: state.request.url,
    status: state.error?.status,
    retryCount: state.retryCount,
  });
  return state;
};
```

---

## RequestState

钩子系统共享的可变状态，结构如下：

```ts
interface RequestState {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  };
  response?: {
    status: number;
    data: unknown;
    headers: Record<string, string>;
  };
  error?: ApiError;
  retryCount: number;
  options: NormalizedRequestOptions;
  cache?: { key: string; hit: boolean; stale: boolean };
  meta: Record<string, unknown>;  // 自由扩展
}
```

`meta` 字段可用于在钩子之间传递自定义上下文。
