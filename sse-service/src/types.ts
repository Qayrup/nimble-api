export interface SSEEvent {
  event: string;
  data: unknown;
  id?: string;
  explicitEvent: boolean;
}

export interface SSEReconnect {
  maxAttempts?: number;
  interval?: number;
  /** Upper bound for exponential backoff delay (ms). Default 30000. */
  maxInterval?: number;
}

export interface SSEOptions {
  baseUrl?: string;
  /** HTTP method. Default 'GET'. Set to 'POST' for streaming APIs that accept a request body. */
  method?: string;
  /** Request body for POST requests. Ignored for GET. */
  body?: string | Record<string, unknown> | FormData;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  params?: Record<string, string | number>;
  reconnect?: SSEReconnect | false;
  signal?: AbortSignal;
}

export enum ReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSED = 2,
}

export interface SSEConnection {
  readonly readyState: ReadyState;
  readonly url: string;
  on<T = unknown>(event: string, handler: (data: T) => void): () => void;
  onMessage(handler: (event: string, data: unknown) => void): () => void;
  onOpen(handler: () => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
  dispose(): void;
  [Symbol.dispose](): void;
}
