import { ReadyState } from './types';
import type { SSEEvent, SSEOptions, SSEConnection } from './types';

type AnyHandler = (...args: unknown[]) => void;

class SSEConnectionImpl implements SSEConnection {
  #url: string;
  #options: SSEOptions;
  #abortController: AbortController | null = null;
  #handlers = new Map<string, Set<AnyHandler>>();
  #messageHandlers = new Set<(event: string, data: unknown) => void>();
  #openHandlers = new Set<() => void>();
  #errorHandlers = new Set<(error: Error) => void>();
  #closeHandlers = new Set<() => void>();
  #readyState = ReadyState.CONNECTING;
  get #closed(): boolean { return this.#readyState === ReadyState.CLOSED; }
  #reconnectAttempts = 0;
  #lastEventId: string | null = null;
  #buffer = '';
  #maxBufferSize = 1024 * 1024; // 1MB
  #serverRetry: number | null = null;

  get readyState(): ReadyState { return this.#readyState; }
  get url(): string { return this.#url; }

  constructor(url: string, options: SSEOptions = {}) {
    this.#url = url;
    this.#options = options;
    this.#connect();
  }

  on<T = unknown>(event: string, handler: (data: T) => void): () => void {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    const h = handler as AnyHandler;
    this.#handlers.get(event)!.add(h);
    return () => { this.#handlers.get(event)?.delete(h); };
  }

  onMessage(handler: (event: string, data: unknown) => void): () => void {
    this.#messageHandlers.add(handler);
    return () => { this.#messageHandlers.delete(handler); };
  }

  onOpen(handler: () => void): () => void {
    this.#openHandlers.add(handler);
    return () => { this.#openHandlers.delete(handler); };
  }

  onError(handler: (error: Error) => void): () => void {
    this.#errorHandlers.add(handler);
    return () => { this.#errorHandlers.delete(handler); };
  }

  onClose(handler: () => void): () => void {
    this.#closeHandlers.add(handler);
    return () => { this.#closeHandlers.delete(handler); };
  }

  close(): void {
    this.#readyState = ReadyState.CLOSED;
    this.#abortController?.abort();
    this.#notifyClose();
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;

    const baseUrl = this.#options.baseUrl ?? '';
    let url = baseUrl + this.#url;
    if (this.#options.params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(this.#options.params)) {
        sp.append(k, String(v));
      }
      const qs = sp.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...this.#options.headers,
    };
    if (this.#lastEventId) {
      headers['Last-Event-ID'] = this.#lastEventId;
    }

    this.#abortController = new AbortController();
    const mergedSignal = this.#abortController.signal;

    if (this.#options.signal) {
      if (this.#options.signal.aborted) return;
      this.#options.signal.addEventListener('abort', () => this.close(), { once: true });
    }

    const method = (this.#options.method ?? 'GET').toUpperCase();

    try {
      const fetchInit: RequestInit = {
        method,
        headers,
        credentials: this.#options.withCredentials ? 'include' : 'same-origin',
        signal: mergedSignal,
      };

      if (method !== 'GET' && method !== 'HEAD' && this.#options.body != null) {
        if (typeof this.#options.body === 'string') {
          fetchInit.body = this.#options.body;
        } else if (this.#options.body instanceof FormData) {
          fetchInit.body = this.#options.body;
        } else {
          fetchInit.body = JSON.stringify(this.#options.body);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
      }

      const res = await fetch(url, fetchInit);

      if (!res.ok) {
        throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        throw new Error(`SSE expected text/event-stream, got ${contentType}`);
      }

      this.#reconnectAttempts = 0;
      this.#readyState = ReadyState.OPEN;
      this.#notifyOpen();
      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!this.#closed) this.#scheduleReconnect();
          break;
        }

        this.#buffer += decoder.decode(value, { stream: true });
        if (this.#buffer.length > this.#maxBufferSize) {
          this.close();
          this.#notifyError(new Error('SSE buffer exceeded max size (1MB)'));
          return;
        }
        this.#parseBuffer();
      }
    } catch (err) {
      if (this.#closed) return;
      this.#notifyError(err instanceof Error ? err : new Error(String(err)));
      this.#scheduleReconnect();
    }
  }

  #parseBuffer(): void {
    const lines = this.#buffer.split('\n');
    this.#buffer = lines.pop() ?? '';

    let eventType = 'message';
    let dataLines: string[] = [];
    let id: string | undefined;
    let explicitEvent = false;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (line === '') {
        if (dataLines.length > 0) {
          const raw = dataLines.join('\n');
          const data = this.#parseData(raw);
          const evt: SSEEvent = { event: eventType, data, id, explicitEvent };
          if (id) this.#lastEventId = id;
          this.#dispatch(evt);
        }
        eventType = 'message';
        explicitEvent = false;
        dataLines = [];
        id = undefined;
        continue;
      }

      if (line.startsWith(':')) continue; // Comment

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const field = line.slice(0, colonIdx);
      let value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      switch (field) {
        case 'event': eventType = value; explicitEvent = true; break;
        case 'data': dataLines.push(value); break;
        case 'id': id = value; break;
        case 'retry': {
          const ms = parseInt(value, 10);
          if (!isNaN(ms) && ms > 0) this.#serverRetry = ms;
          break;
        }
      }
    }
  }

  #parseData(raw: string): unknown {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  #dispatch(evt: SSEEvent): void {
    const handlers = this.#handlers.get(evt.event);
    if (handlers) {
      for (const h of handlers) {
        try { h(evt.data); } catch { /* handler errors are silent */ }
      }
    }

    if (!evt.explicitEvent && evt.event !== 'message') {
      const fallback = this.#handlers.get('message');
      if (fallback) {
        for (const h of fallback) {
          try { h(evt.data); } catch { /* handler errors are silent */ }
        }
      }
    }

    for (const h of this.#messageHandlers) {
      try { h(evt.event, evt.data); } catch { /* handler errors are silent */ }
    }
  }

  #scheduleReconnect(): void {
    this.#readyState = ReadyState.CONNECTING;
    const cfg = this.#options.reconnect;
    if (cfg === false) return;

    const maxAttempts = (cfg && typeof cfg === 'object' ? cfg.maxAttempts : undefined) ?? Infinity;
    const interval = (cfg && typeof cfg === 'object' ? cfg.interval : undefined) ?? this.#serverRetry ?? 3000;

    this.#reconnectAttempts++;
    if (this.#reconnectAttempts >= maxAttempts) {
      this.#notifyError(new Error('SSE max reconnect attempts exceeded'));
      return;
    }

    setTimeout(() => this.#connect(), interval);
  }

  #notifyError(err: Error): void {
    for (const h of this.#errorHandlers) {
      try { h(err); } catch { /* handler errors are silent */ }
    }
  }

  #notifyOpen(): void {
    for (const h of this.#openHandlers) {
      try { h(); } catch { /* handler errors are silent */ }
    }
  }

  #notifyClose(): void {
    for (const h of this.#closeHandlers) {
      try { h(); } catch { /* handler errors are silent */ }
    }
  }
}

export function createSSE(url: string, options?: SSEOptions): SSEConnection {
  return new SSEConnectionImpl(url, options);
}
