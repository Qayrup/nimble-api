import { ApiClient } from './client';
import type { ApiOptions } from './core/types';

export { ApiClient } from './client';
export { MemoryCache } from './core/cache';
export { createFetchAdapter } from './adapters/fetch';
export { createUniAppAdapter } from './adapters/uniapp';
export { createXhrAdapter } from './adapters/xhr';
export { createTypedApi } from './typed';
export { ApiError, NetworkError, stop } from './core/types';
export { calcBackoff, shouldRetry, DEFAULT_RETRY } from './retry';
export { runBeforeRequest, runAfterResponse, runBeforeRetry, runBeforeError, runInitHooks } from './hooks';
export { createBearerAuth } from './auth';

export type {
  ApiOptions,
  RequestOptions,
  RequestState,
  NormalizedRequestOptions,
  RequestAdapter,
  AdapterRequestConfig,
  AdapterResponse,
  Hooks,
  InitHook,
  BeforeRequestHook,
  AfterResponseHook,
  BeforeRetryHook,
  BeforeErrorHook,
  CacheControl,
  CacheOptions,
  RetryConfig,
  SchemaValidator,
  EntityDef,
  EndpointSpec,
  ApiDefinition,
  TypedApi,
  EventHubLike,
  ApiErrorCode,
} from './core/types';

export function createApiClient(options?: ApiOptions): ApiClient {
  return new ApiClient(options);
}
