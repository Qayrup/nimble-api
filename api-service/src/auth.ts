import type { BeforeRequestHook } from './core/types';

export function createBearerAuth(token: string | (() => string)): BeforeRequestHook {
  return (state) => ({
    ...state,
    request: {
      ...state.request,
      headers: {
        ...state.request.headers,
        Authorization: `Bearer ${typeof token === 'function' ? token() : token}`,
      },
    },
  });
}
