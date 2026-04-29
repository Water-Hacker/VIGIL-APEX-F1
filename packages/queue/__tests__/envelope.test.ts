import { describe, expect, it } from 'vitest';

import { STREAMS, groupName, consumerName, newEnvelope } from '../src/index.js';

describe('@vigil/queue — envelope + stream helpers', () => {
  it('STREAMS contains every documented stream and values are kebab-prefixed', () => {
    const values = Object.values(STREAMS);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(typeof v).toBe('string');
      // Streams must be in the vigil: namespace.
      expect(v.startsWith('vigil:')).toBe(true);
    }
  });

  it('groupName derives a unique consumer-group name per worker', () => {
    expect(groupName('worker-anchor')).toBe('cg:worker-anchor');
    expect(groupName('worker-dossier')).toBe('cg:worker-dossier');
    expect(groupName('worker-anchor')).not.toBe(groupName('worker-dossier'));
  });

  it('consumerName combines worker + instance', () => {
    const c = consumerName('worker-anchor', 'instance-1');
    expect(c).toContain('worker-anchor');
    expect(c).toContain('instance-1');
  });

  it('newEnvelope produces a complete envelope with stable shape', () => {
    const e = newEnvelope('producer-x', { foo: 'bar' }, 'dedup-1');
    expect(e.producer).toBe('producer-x');
    expect(e.dedup_key).toBe('dedup-1');
    expect(e.payload).toEqual({ foo: 'bar' });
    expect(e.schema_version).toBe(1);
    expect(typeof e.id).toBe('string');
    expect(typeof e.correlation_id).toBe('string');
    expect(typeof e.produced_at).toBe('string');
    expect(() => new Date(e.produced_at)).not.toThrow();
    expect(Date.parse(e.produced_at)).not.toBeNaN();
  });

  it('newEnvelope preserves a passed-in correlation_id', () => {
    const cid = '11111111-1111-1111-1111-111111111111';
    const e = newEnvelope('p', { x: 1 }, 'd', cid);
    expect(e.correlation_id).toBe(cid);
  });

  it('newEnvelope IDs are unique across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newEnvelope('p', {}, `d-${i}`).id);
    }
    expect(ids.size).toBe(100);
  });
});
