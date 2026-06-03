import { ApiClient, apiProxyHandler } from './core/ApiClient';
import type { ApiConfig, ApiClientSettings, ApiMethod, CallOptions, ApiPlugin, RequestAdapter, EndpointConfig } from './core/types';
import { MemoryCache } from './core/cache';
import { PluginManager } from './plugins/manager';
import { createFetchAdapter } from './adapters/fetch';
import { createUniAppAdapter } from './adapters/uniapp';

export type {
  ApiConfig,
  ApiClientSettings,
  ApiMethod,
  CallOptions,
  ApiPlugin,
  RequestAdapter,
  EndpointConfig,
};

export { MemoryCache, PluginManager, createFetchAdapter, createUniAppAdapter };

let singletonInstance: ApiClient | undefined;

export function createApiClient(
  config: ApiConfig,
  settings?: ApiClientSettings,
): ApiClient {
  const client = new ApiClient(config, settings);
  return new Proxy(client, apiProxyHandler) as unknown as ApiClient;
}

export function initApiClient(
  config: ApiConfig,
  settings?: ApiClientSettings,
): ApiClient {
  if (singletonInstance) {
    console.warn('[@nimble-api/api-service] Already initialized, returning existing instance');
    return singletonInstance;
  }
  singletonInstance = createApiClient(config, settings) as unknown as ApiClient;
  return singletonInstance;
}

export function getApiClient(): ApiClient {
  if (!singletonInstance) {
    throw new Error('[@nimble-api/api-service] Not initialized. Call initApiClient() first.');
  }
  return singletonInstance;
}

export function destroyApiClient(): void {
  singletonInstance?.destroy();
  singletonInstance = undefined;
}

const proxyHandler: ProxyHandler<object> = {
  get(_target, prop) {
    if (!singletonInstance) {
      throw new Error(
        '[@nimble-api/api-service] Not initialized. Call initApiClient() first.',
      );
    }
    return Reflect.get(singletonInstance, prop);
  },
  set: () => {
    throw new Error('[@nimble-api/api-service] is read-only.');
  },
  deleteProperty: () => {
    throw new Error('[@nimble-api/api-service] is read-only.');
  },
};

export default new Proxy({}, proxyHandler) as ApiClient;
