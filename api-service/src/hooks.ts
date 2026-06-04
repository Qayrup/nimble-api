import { stop, type Hooks, type RequestState, type RequestOptions } from './core/types';

export async function runInitHooks(
  hooks: Hooks | undefined,
  opts: RequestOptions,
): Promise<RequestOptions> {
  if (!hooks?.init?.length) return opts;
  let current = opts;
  for (const hook of hooks.init) {
    current = await hook(current);
  }
  return current;
}

export async function runBeforeRequest(
  hooks: Hooks | undefined,
  state: RequestState,
): Promise<RequestState> {
  if (!hooks?.beforeRequest?.length) return state;
  let current = state;
  for (const hook of hooks.beforeRequest) {
    current = await hook(current);
  }
  return current;
}

export async function runAfterResponse(
  hooks: Hooks | undefined,
  state: RequestState,
): Promise<RequestState> {
  if (!hooks?.afterResponse?.length) return state;
  let current = state;
  for (let i = hooks.afterResponse.length - 1; i >= 0; i--) {
    current = await hooks.afterResponse[i](current);
  }
  return current;
}

export async function runBeforeRetry(
  hooks: Hooks | undefined,
  state: RequestState,
): Promise<RequestState | typeof stop> {
  if (!hooks?.beforeRetry?.length) return state;
  let current: RequestState = state;
  for (const hook of hooks.beforeRetry) {
    const result = await hook(current);
    if (result === stop) return stop;
    current = result as RequestState;
  }
  return current;
}

export async function runBeforeError(
  hooks: Hooks | undefined,
  state: RequestState,
): Promise<RequestState> {
  if (!hooks?.beforeError?.length) return state;
  let current = state;
  for (const hook of hooks.beforeError) {
    current = await hook(current);
  }
  return current;
}
