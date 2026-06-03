import type { EventMap, Middleware } from './types';

export function createMiddlewareChain<T extends EventMap>(
  middlewares: Middleware<T>[],
): Middleware<T> {
  if (middlewares.length === 0) {
    return (_event, _payload, next) => next();
  }
  return middlewares.reduceRight<Middleware<T>>(
    (next, mw) => (event, payload, finalNext) => {
      mw(event, payload, () => next(event, payload, finalNext));
    },
    (_event, _payload, finalNext) => finalNext(),
  );
}
