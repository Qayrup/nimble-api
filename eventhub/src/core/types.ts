export type EventMap = Record<string, unknown>;

export type EventHandler<T extends EventMap, K extends keyof T> = (payload: T[K]) => void;

export type WildcardHandler<T extends EventMap> = (
  event: keyof T & string,
  payload: T[keyof T],
) => void;

export interface ListenerOptions {
  signal?: AbortSignal;
  once?: boolean;
}

export type Middleware<T extends EventMap> = (
  event: keyof T & string,
  payload: T[keyof T],
  next: () => void,
) => void | Promise<void>;

export type PrefixKeys<T extends EventMap, P extends string> = {
  [K in keyof T & string]: K extends `${P}${string}` ? K : never;
}[keyof T & string];

export interface EventHubSettings {
  strictMode?: boolean;
  maxListeners?: number;
}

export type InternalHandler = {
  (payload: unknown): void;
  original?: (...args: unknown[]) => void;
  once?: boolean;
};
