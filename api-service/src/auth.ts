import type { BeforeRequestHook } from './core/types';

export function createBearerAuth(token: string | (() => string)): BeforeRequestHook {
  return (state) => {
    // Skip if Authorization header is already set (e.g., custom auth schemes, Basic auth)
    if (Object.keys(state.request.headers).some(k => k.toLowerCase() === 'authorization')) {
      return state;
    }
    return {
      ...state,
      request: {
        ...state.request,
        headers: {
          ...state.request.headers,
          Authorization: `Bearer ${typeof token === 'function' ? token() : token}`,
        },
      },
    };
  };
}
