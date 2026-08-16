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
  #signalOnAbort: (() => void) | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #stabilityTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.#signalOnAbort) {
      this.#options.signal?.removeEventListener('abort', this.#signalOnAbort);
      this.#signalOnAbort = null;
    }
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#stabilityTimer) {
      clearTimeout(this.#stabilityTimer);
      this.#stabilityTimer = null;
    }
    this.#readyState = ReadyState.CLOSED;
    this.#abortController?.abort();
    this.#notifyClose();
    this.#handlers.clear();
    this.#messageHandlers.clear();
    this.#openHandlers.clear();
    this.#errorHandlers.clear();
    this.#closeHandlers.clear();
  }

  dispose(): void {
    this.close();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;

    // 重连时清空上一连接残留的半行，避免拼接到新连接数据造成事件损坏
    this.#buffer = '';

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
      if (this.#options.signal.aborted) {
        this.#readyState = ReadyState.CLOSED;
        this.#notifyError(new Error('SSE connection aborted'));
        return;
      }
      // Remove stale listener from a previous connection before adding a new one
      if (this.#signalOnAbort) {
        this.#options.signal.removeEventListener('abort', this.#signalOnAbort);
      }
      this.#signalOnAbort = () => this.close();
      this.#options.signal.addEventListener('abort', this.#signalOnAbort, { once: true });
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
        await res.body?.cancel();
        throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        await res.body?.cancel();
        throw new Error(`SSE expected text/event-stream, got ${contentType}`);
      }

      this.#readyState = ReadyState.OPEN;
      this.#notifyOpen();
      this.#armStabilityTimer();
      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // SSE 协议预期行为：流关闭后自动重连（浏览器原生 EventSource 同）。控制：reconnect: false 禁用，reconnect.maxAttempts 限制次数。
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
    let eventType = 'message';
    let dataLines: string[] = [];
    let id: string | undefined;
    let explicitEvent = false;

    // Scan line by line without allocating a split array — SSE can be high frequency
    let start = 0;
    let idx: number;
    while ((idx = this.#buffer.indexOf('\n', start)) !== -1) {
      let line = this.#buffer.slice(start, idx);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      start = idx + 1;

      if (line === '') {
        if (id !== undefined) this.#lastEventId = id;
        if (dataLines.length > 0) {
          const raw = dataLines.join('\n');
          const data = this.#parseData(raw);
          const evt: SSEEvent = { event: eventType, data, id, explicitEvent };
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
      if (colonIdx === -1) {
        // Field name without colon — value is empty string (SSE spec)
        switch (line) {
          case 'event': eventType = ''; explicitEvent = true; break;
          case 'data': dataLines.push(''); break;
          case 'id': id = ''; break;
          case 'retry': break; // retry without value is ignored
        }
        continue;
      }

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

    this.#buffer = this.#buffer.slice(start);
  }

  #parseData(raw: string): unknown {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  #dispatch(evt: SSEEvent): void {
    // 不再在此归零 attempts —— 否则"服务端接受→发一条→断连"抖动下 maxAttempts 永不触发
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

  #baseInterval(): number {
    const cfg = this.#options.reconnect;
    return (cfg && typeof cfg === 'object' ? cfg.interval : undefined) ?? this.#serverRetry ?? 3000;
  }

  #armStabilityTimer(): void {
    if (this.#options.reconnect === false) return;
    if (this.#stabilityTimer) clearTimeout(this.#stabilityTimer);
    this.#stabilityTimer = setTimeout(() => {
      this.#stabilityTimer = null;
      if (this.#readyState === ReadyState.OPEN) this.#reconnectAttempts = 0;
    }, this.#baseInterval());
  }

  #scheduleReconnect(): void {
    this.#readyState = ReadyState.CONNECTING;
    if (this.#stabilityTimer) {
      clearTimeout(this.#stabilityTimer);
      this.#stabilityTimer = null;
    }
    const cfg = this.#options.reconnect;
    if (cfg === false) return;

    const maxAttempts = (cfg && typeof cfg === 'object' ? cfg.maxAttempts : undefined) ?? Infinity;
    const maxInterval = (cfg && typeof cfg === 'object' ? cfg.maxInterval : undefined) ?? 30000;

    if (this.#reconnectAttempts >= maxAttempts) {
      this.#notifyError(new Error('SSE max reconnect attempts exceeded'));
      this.close();
      return;
    }
    this.#reconnectAttempts++;

    const delay = Math.min(this.#baseInterval() * 2 ** (this.#reconnectAttempts - 1), maxInterval);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
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
