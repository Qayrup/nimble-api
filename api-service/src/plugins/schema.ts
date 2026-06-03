import type { ApiPlugin } from '../core/types';

export function createSchemaPlugin(): ApiPlugin {
  return {
    name: 'schema',

    async onResponse(ctx) {
      if (!ctx.config.schema) return ctx;

      const schema = ctx.config.schema as Record<string, unknown>;
      if (typeof schema.parse === 'function') {
        ctx.data = (schema.parse as (d: unknown) => unknown)(ctx.data);
      } else if (typeof schema.safeParse === 'function') {
        const result = (schema as { safeParse: (d: unknown) => { success: boolean; data: unknown; error: unknown } }).safeParse(ctx.data);
        if (!result.success) {
          throw Object.assign(new Error('Schema validation failed'), { validationError: result.error });
        }
        ctx.data = result.data;
      }

      return ctx;
    },
  };
}
