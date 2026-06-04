declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}

export interface SubscribeOptions {
  signal?: AbortSignal;
  /** Debounce in ms — handler fires after the event stream has been silent for this duration */
  debounce?: number;
  /** Throttle in ms — handler fires at most once per this duration (leading edge) */
  throttle?: number;
}

export type Unsubscribe = () => void;

export interface MetaEventPayloads {
  listenerAdded: { event: string };
  listenerRemoved: { event: string };
}
