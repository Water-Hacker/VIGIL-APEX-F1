import { Errors } from '@vigil/shared';

import type { Adapter } from './base.js';

class Registry {
  private readonly bySourceId = new Map<string, Adapter>();

  register(a: Adapter): void {
    if (this.bySourceId.has(a.sourceId)) {
      throw new Errors.VigilError({
        code: 'ADAPTER_DUPLICATE_ID',
        message: `Adapter already registered: ${a.sourceId}`,
        severity: 'fatal',
      });
    }
    this.bySourceId.set(a.sourceId, a);
  }

  get(id: string): Adapter | undefined {
    return this.bySourceId.get(id);
  }

  all(): readonly Adapter[] {
    return [...this.bySourceId.values()];
  }

  count(): number {
    return this.bySourceId.size;
  }
}

export const AdapterRegistry = new Registry();
export const registerAdapter = (a: Adapter): void => AdapterRegistry.register(a);
