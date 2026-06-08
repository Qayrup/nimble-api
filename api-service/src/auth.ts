import type { BeforeRequestHook } from './core/types';

function hasAuthHeader(headers: Record<string, string>): boolean {
  return 'authorization' in headers || 'Authorization' in headers;
}

export function createBearerAuth(token: string | (() => string)): BeforeRequestHook {
  return (state) => {
    if (hasAuthHeader(state.request.headers)) return state;
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

export function createBasicAuth(
  username: string | (() => string),
  password: string | (() => string),
): BeforeRequestHook {
  return (state) => {
    if (hasAuthHeader(state.request.headers)) return state;
    const u = typeof username === 'function' ? username() : username;
    const p = typeof password === 'function' ? password() : password;
    return {
      ...state,
      request: {
        ...state.request,
        headers: {
          ...state.request.headers,
          Authorization: `Basic ${btoa(`${u}:${p}`)}`,
        },
      },
    };
  };
}
