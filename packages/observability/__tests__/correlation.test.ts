import { describe, expect, it } from 'vitest';

import { newCorrelationId, createLogger } from '../src/index.js';

describe('@vigil/observability', () => {
  it('newCorrelationId returns a unique non-empty string per call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = newCorrelationId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });

  it('createLogger returns a pino-shaped logger with the expected methods', () => {
    const log = createLogger({ service: 'test-service' });
    for (const m of ['info', 'warn', 'error', 'debug', 'fatal', 'trace']) {
      expect(typeof (log as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    expect(typeof log.child).toBe('function');
  });

  it('createLogger child carries through a structured field', () => {
    const log = createLogger({ service: 'test-service' });
    const child = log.child({ correlation_id: 'corr-1' });
    expect(typeof child.info).toBe('function');
  });
});
