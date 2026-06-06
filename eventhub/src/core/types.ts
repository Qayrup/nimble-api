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
  /** Throttle firing edge strategy. Default `'both'`. */
  throttleEdge?: 'both' | 'leading' | 'trailing';
}

export type Unsubscribe = () => void;

export interface MetaEventPayloads {
  beforeListenerAdd: { event: string; handler: (...args: any[]) => void };
  listenerAdded: { event: string };
  beforeListenerRemove: { event: string; handler?: (...args: any[]) => void };
  listenerRemoved: { event: string };
}
