# 适配器

适配器是 `ApiClient` 与 HTTP 层的桥梁，实现 `RequestAdapter` 接口即可接入任意请求库。

## RequestAdapter 接口

```ts
export interface RequestAdapter {
  request(config: AdapterRequestConfig): Promise<AdapterResponse>;
}

interface AdapterRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
}

interface AdapterResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}
```

---

## fetch 适配器

内置适配器，基于标准 `fetch` API，支持浏览器和 Node.js 18+。

```ts
import { createFetchAdapter } from '@nimble-api/api-service';

const adapter = createFetchAdapter(30000); // timeout = 30s
```

**特性：**
- GET/DELETE 请求自动将 body 转为 query string
- 自动检测 `Content-Type` 并解析 JSON/文本响应
- 无效 JSON 响应抛出明确错误
- 支持外部 AbortSignal 和内部超时自动 abort

---

## uni-app 适配器

适配微信小程序 / 支付宝小程序等 uni-app 环境。

```ts
import { createUniAppAdapter } from '@nimble-api/api-service';

const adapter = createUniAppAdapter();
```

**特性：**
- 自动检测 `globalThis.uni` 全局对象（带缓存）
- 支持 `uni.request()` 和 `uni.uploadFile()`
- 方法 `UPLOAD` 自动映射到 `uni.uploadFile`

---

## XHR 适配器

基于 `XMLHttpRequest` 的适配器，支持上传/下载进度回调——fetch 适配器受限于 Streams API 无法原生支持 `onUploadProgress`。

```ts
import { createXhrAdapter } from '@nimble-api/api-service';

const adapter = createXhrAdapter(30000); // timeout = 30s

const api = createApiClient({ adapter });
```

**特性：**
- 支持 `onUploadProgress` 和 `onDownloadProgress` 回调
- `responseType: 'blob'` / `'arrayBuffer'` 设置 `xhr.responseType`
- 表单数据 (`FormData`) 直接传入 `xhr.send()` 不做序列化
- 解析响应头为 `Record<string, string>`（key 转小写）

```ts
await api.post('/upload', {
  form: myFormData,
  onUploadProgress: ({ loaded, total }) => {
    console.log(`已上传: ${((loaded / total) * 100).toFixed(1)}%`);
  },
});
```

> fetch 适配器**不支持** `onUploadProgress` / `onDownloadProgress`。需要进度回调时请使用 XHR 适配器。

---

## 自定义适配器

实现 `RequestAdapter` 接口即可接入任何 HTTP 库：

```ts
import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '@nimble-api/api-service';

// 基于 axios 的适配器示例
function createAxiosAdapter(axiosInstance: AxiosInstance): RequestAdapter {
  return {
    async request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      const res = await axiosInstance.request({
        url: config.url,
        method: config.method,
        headers: config.headers,
        data: config.body,
        signal: config.signal,
        timeout: config.timeout,
      });
      return {
        status: res.status,
        data: res.data,
        headers: res.headers as Record<string, string>,
      };
    },
  };
}

// 使用
const api = createApiClient({
  adapter: createAxiosAdapter(axios.create()),
});
```
