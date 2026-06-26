import type { TokenSet } from './types';

type SyncSource = 'login' | 'silent-refresh' | 'logout' | 'expired';

interface SyncMessage {
  type: 'token_sync';
  token: TokenSet | null;
  source: SyncSource;
  timestamp: number;
}

function hasBroadcastChannel(): boolean {
  try {
    return typeof BroadcastChannel !== 'undefined';
  } catch {
    return false;
  }
}

export class SessionSync {
  #channel: BroadcastChannel | null = null;
  #listeners = new Set<(token: TokenSet | null, source: 'login' | 'silent-refresh' | 'logout' | 'expired') => void>();

  constructor(channelName: string) {
    if (!hasBroadcastChannel()) return; // Node SSR / old browser — silent no-op
    try {
      this.#channel = new BroadcastChannel(`oidc:session:${channelName}`);
      this.#channel.onmessage = (evt: MessageEvent<SyncMessage>) => {
        const msg = evt.data;
        if (msg?.type !== 'token_sync') return;
        // Skip updates that are already expired
        if (msg.token && typeof msg.token.expiresAt === 'number' && msg.token.expiresAt <= Date.now()) {
          return;
        }
        for (const cb of this.#listeners) {
          cb(msg.token, msg.source as 'login' | 'silent-refresh' | 'logout' | 'expired');
        }
      };
    } catch { /* silently degrade */ }
  }

  broadcast(token: TokenSet | null, source: 'login' | 'silent-refresh' | 'logout' | 'expired'): void {
    if (!this.#channel) return;
    try {
      const msg: SyncMessage = { type: 'token_sync', token, source, timestamp: Date.now() };
      this.#channel.postMessage(msg);
    } catch { /* ignore */ }
  }

  onUpdate(cb: (token: TokenSet | null, source: 'login' | 'silent-refresh' | 'logout' | 'expired') => void): () => void {
    this.#listeners.add(cb);
    return () => { this.#listeners.delete(cb); };
  }

  close(): void {
    if (this.#channel) {
      try { this.#channel.close(); } catch { /* ignore */ }
      this.#channel = null;
    }
    this.#listeners.clear();
  }
}
