import type { TokenSet } from './types';

type SyncSource = 'login' | 'silent-refresh' | 'logout' | 'expired';

interface SyncMessage {
  type: 'token_sync';
  token: TokenSet | null;
  source: SyncSource;
  timestamp: number;
}

interface ProbeMessage {
  type: 'token_probe';
}

type ChannelMessage = SyncMessage | ProbeMessage;

function hasBroadcastChannel(): boolean {
  try {
    return typeof BroadcastChannel !== 'undefined';
  } catch {
    return false;
  }
}

export class SessionSync {
  #channel: BroadcastChannel | null = null;
  #listeners = new Set<(token: TokenSet | null, source: SyncSource) => void>();
  #probeHandlers = new Set<() => void>();

  constructor(channelName: string) {
    if (!hasBroadcastChannel()) return;
    try {
      this.#channel = new BroadcastChannel(`oidc:session:${channelName}`);
      this.#channel.onmessage = (evt: MessageEvent<ChannelMessage>) => {
        const msg = evt.data;
        if (msg?.type === 'token_sync') {
          if (msg.token && typeof msg.token.expiresAt === 'number' && msg.token.expiresAt <= Date.now()) {
            return;
          }
          for (const cb of this.#listeners) {
            cb(msg.token, msg.source as SyncSource);
          }
        } else if (msg?.type === 'token_probe') {
          for (const cb of this.#probeHandlers) {
            try { cb(); } catch { /* probe handler errors are silent */ }
          }
        }
      };
    } catch { /* silently degrade */ }
  }

  broadcast(token: TokenSet | null, source: SyncSource): void {
    if (!this.#channel) return;
    try {
      const msg: SyncMessage = { type: 'token_sync', token, source, timestamp: Date.now() };
      this.#channel.postMessage(msg);
    } catch { /* ignore */ }
  }

  onUpdate(cb: (token: TokenSet | null, source: SyncSource) => void): () => void {
    this.#listeners.add(cb);
    return () => { this.#listeners.delete(cb); };
  }

  onProbe(cb: () => void): () => void {
    this.#probeHandlers.add(cb);
    return () => { this.#probeHandlers.delete(cb); };
  }

  sendProbe(): void {
    if (!this.#channel) return;
    try {
      const msg: ProbeMessage = { type: 'token_probe' };
      this.#channel.postMessage(msg);
    } catch { /* ignore */ }
  }

  waitForSync(timeoutMs = 300): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#channel) { resolve(); return; }

      const timer = setTimeout(() => {
        unsub();
        resolve();
      }, timeoutMs);

      const unsub = this.onUpdate(() => {
        clearTimeout(timer);
        unsub();
        resolve();
      });

      this.sendProbe();
    });
  }

  close(): void {
    if (this.#channel) {
      try { this.#channel.close(); } catch { /* ignore */ }
      this.#channel = null;
    }
    this.#listeners.clear();
    this.#probeHandlers.clear();
  }

  dispose(): void {
    this.close();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
