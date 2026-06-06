export interface SSEEvent {
  event: string;
  data: unknown;
  id?: string;
  explicitEvent: boolean;
}

export interface SSEReconnect {
  maxAttempts?: number;
  interval?: number;
}

export interface SSEOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  params?: Record<string, string | number>;
  reconnect?: SSEReconnect | false;
  signal?: AbortSignal;
}

export interface SSEConnection {
  on<T = unknown>(event: string, handler: (data: T) => void): () => void;
  onMessage(handler: (event: string, data: unknown) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}
