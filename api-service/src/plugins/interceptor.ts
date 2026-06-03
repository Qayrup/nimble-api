import type { ApiPlugin, RequestContext, ResponseContext } from '../core/types';

type InterceptorFn = (ctx: RequestContext) => RequestContext | Promise<RequestContext>;
type ResponseInterceptorFn = (ctx: ResponseContext) => ResponseContext | Promise<ResponseContext>;

export function createInterceptorPlugin(): ApiPlugin & {
  addRequest(fn: InterceptorFn): void;
  addResponse(fn: ResponseInterceptorFn): void;
} {
  const requestInterceptors: InterceptorFn[] = [];
  const responseInterceptors: ResponseInterceptorFn[] = [];

  return {
    name: 'interceptor',

    async onRequest(ctx) {
      let current = ctx;
      for (const fn of requestInterceptors) {
        current = await fn(current);
      }
      return current;
    },

    async onResponse(ctx) {
      let current = ctx;
      for (const fn of responseInterceptors) {
        current = await fn(current);
      }
      return current;
    },

    addRequest(fn) {
      requestInterceptors.push(fn);
    },

    addResponse(fn) {
      responseInterceptors.push(fn);
    },
  };
}
