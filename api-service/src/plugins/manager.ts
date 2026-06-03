import type { ApiPlugin, RequestContext, ResponseContext, ErrorContext } from '../core/types';

export class PluginManager {
  #plugins: ApiPlugin[] = [];

  register(plugin: ApiPlugin): void {
    if (this.#plugins.some(p => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.#plugins.push(plugin);
  }

  unregister(name: string): void {
    this.#plugins = this.#plugins.filter(p => p.name !== name);
  }

  async runOnRequest(ctx: RequestContext): Promise<RequestContext> {
    let current = ctx;
    for (const plugin of this.#plugins) {
      if (plugin.onRequest) {
        current = await plugin.onRequest(current);
      }
    }
    return current;
  }

  async runOnResponse(ctx: ResponseContext): Promise<ResponseContext> {
    let current = ctx;
    for (let i = this.#plugins.length - 1; i >= 0; i--) {
      const hook = this.#plugins[i].onResponse;
      if (hook) {
        current = await hook(current);
      }
    }
    return current;
  }

  async runOnError(ctx: ErrorContext): Promise<ErrorContext> {
    let current = ctx;
    for (const plugin of this.#plugins) {
      if (plugin.onError) {
        current = await plugin.onError(current);
      }
    }
    return current;
  }

  setupAll(client: unknown): void {
    for (const plugin of this.#plugins) {
      plugin.setup?.(client);
    }
  }

  teardownAll(): void {
    for (const plugin of this.#plugins) {
      plugin.teardown?.();
    }
    this.#plugins.length = 0;
  }
}
