export type EventMap = Record<string, unknown>;

export interface SubscribeOptions {
  signal?: AbortSignal;
}

export type Unsubscribe = () => void;

export interface MetaEventPayloads {
  listenerAdded: { event: string };
  listenerRemoved: { event: string };
}
