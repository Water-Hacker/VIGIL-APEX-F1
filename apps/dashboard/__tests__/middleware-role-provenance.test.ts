import { describe, expect, it } from 'vitest';

import { rolesFromToken } from '../src/middleware';

/**
 * Mode 4.2 — Confused-deputy across service boundary.
 *
 * Pre-closure, `rolesFromToken` returned a single Set<string> that
 * merged realm-level roles (assigned globally by the realm admin) and
 * resource-level roles (assigned per client by a separate admin).
 * Downstream consumers couldn't tell where a role originated; a
 * compromised per-client role mapper would be indistinguishable from
 * a legit realm-level assignment.
 *
 * The closure exposes role provenance via two new downstream headers
 * (`x-vigil-roles-realm`, `x-vigil-roles-resource`) computed from a
 * typed `{ realm, resource, merged }` return shape. Consumers that
 * require realm-level provenance can check the realm slice directly.
 *
 * These tests pin the typed return contract.
 */

interface PayloadShape {
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'vigil-dashboard';

describe('rolesFromToken (mode 4.2)', () => {
  it('returns realm-only roles when the token has only realm_access', () => {
    const payload: PayloadShape = {
      realm_access: { roles: ['operator', 'auditor'] },
    };
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    expect(r.realm).toEqual(['operator', 'auditor']);
    expect(r.resource).toEqual([]);
    expect(Array.from(r.merged).sort()).toEqual(['auditor', 'operator']);
  });

  it('returns resource-only roles when the token has only resource_access[CLIENT_ID]', () => {
    const payload: PayloadShape = {
      resource_access: { [KEYCLOAK_CLIENT_ID]: { roles: ['council_member'] } },
    };
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    expect(r.realm).toEqual([]);
    expect(r.resource).toEqual(['council_member']);
    expect(Array.from(r.merged)).toEqual(['council_member']);
  });

  it('keeps the two slices DISTINCT even when both are present', () => {
    const payload: PayloadShape = {
      realm_access: { roles: ['operator'] },
      resource_access: { [KEYCLOAK_CLIENT_ID]: { roles: ['auditor'] } },
    };
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    // The slices are independent; the consumer can require realm
    // provenance specifically by checking r.realm alone.
    expect(r.realm).toEqual(['operator']);
    expect(r.resource).toEqual(['auditor']);
    expect(Array.from(r.merged).sort()).toEqual(['auditor', 'operator']);
  });

  it('deduplicates merged but keeps duplicates in the per-slice arrays', () => {
    // Same role assigned both at realm and at resource level: merged
    // deduplicates (Set semantics), but the slices preserve the source.
    const payload: PayloadShape = {
      realm_access: { roles: ['operator'] },
      resource_access: { [KEYCLOAK_CLIENT_ID]: { roles: ['operator'] } },
    };
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    expect(r.realm).toEqual(['operator']);
    expect(r.resource).toEqual(['operator']);
    expect(Array.from(r.merged)).toEqual(['operator']);
  });

  it('ignores resource_access entries for OTHER clients (provenance is per-client)', () => {
    const payload: PayloadShape = {
      realm_access: { roles: ['operator'] },
      resource_access: {
        [KEYCLOAK_CLIENT_ID]: { roles: ['auditor'] },
        // A completely different client's role mapper has no business
        // granting roles to OUR application. The function must ignore
        // it entirely.
        'some-other-client': { roles: ['admin', 'root'] },
      },
    };
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    expect(r.resource).toEqual(['auditor']);
    expect(Array.from(r.merged).sort()).toEqual(['auditor', 'operator']);
    expect(r.merged.has('admin')).toBe(false);
    expect(r.merged.has('root')).toBe(false);
  });

  it('returns empty slices when the token has neither realm_access nor resource_access', () => {
    const payload: PayloadShape = {};
    const r = rolesFromToken(payload as Parameters<typeof rolesFromToken>[0]);
    expect(r.realm).toEqual([]);
    expect(r.resource).toEqual([]);
    expect(r.merged.size).toBe(0);
  });
});
