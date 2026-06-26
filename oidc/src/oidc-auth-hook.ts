import type { BeforeRequestHook, BeforeRetryHook, RequestState } from '@nimble-api/api-service';
import { createBearerAuth, stop } from '@nimble-api/api-service';
import type { OidcClient } from './OidcClient';

export function createOidcAuthHook(client: OidcClient): BeforeRequestHook {
  return createBearerAuth(() => client.getAccessToken() ?? '');
}

export function createOidcRetryHook(client: OidcClient): BeforeRetryHook {
  return (state) => {
    if (state.response?.status === 401 && !state.meta.__oidc_retried) {
      state.meta.__oidc_retried = true;
      return client.silentRefresh().then((refreshed): RequestState | typeof stop => {
        if (!refreshed) return stop;
        return state;
      }) as Promise<RequestState>;
    }
    return state;
  };
}
