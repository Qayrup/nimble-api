declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}

export interface SubscribeOptions {
  signal?: AbortSignal;
}

export type Unsubscribe = () => void;

export interface MetaEventPayloads {
  listenerAdded: { event: string };
  listenerRemoved: { event: string };
}
