import { describe, expect, it } from 'vitest';

import {
  ROLES,
  OPERATOR_TIER_ROLES,
  READ_ONLY_TIER_ROLES,
  isRole,
  parseRolesHeader,
  isOperatorTier,
  type Role,
} from '../src/roles.js';

describe('roles registry (FIND-008)', () => {
  it('declares the six Keycloak roles known to the platform', () => {
    expect(new Set(ROLES)).toEqual(
      new Set([
        'operator',
        'auditor',
        'architect',
        'council_member',
        'tip_handler',
        'civil_society',
      ]),
    );
  });

  it('partitions every role into exactly one tier (operator or read-only)', () => {
    for (const r of ROLES) {
      const inOperator = OPERATOR_TIER_ROLES.has(r);
      const inReadOnly = READ_ONLY_TIER_ROLES.has(r);
      // Exactly one tier per role
      expect(inOperator !== inReadOnly).toBe(true);
    }
  });

  it('isRole returns true only for declared role strings', () => {
    expect(isRole('operator')).toBe(true);
    expect(isRole('architect')).toBe(true);
    expect(isRole('council_member')).toBe(true);
    expect(isRole('public')).toBe(false);
    expect(isRole('councl_member')).toBe(false); // typo guard
    expect(isRole('')).toBe(false);
  });

  it('parseRolesHeader drops unknown values and returns a typed Set', () => {
    const parsed = parseRolesHeader('operator, councl_member, architect , junk');
    expect(parsed.has('operator')).toBe(true);
    expect(parsed.has('architect')).toBe(true);
    expect(parsed.size).toBe(2);
  });

  it('parseRolesHeader handles null / empty input', () => {
    expect(parseRolesHeader(null).size).toBe(0);
    expect(parseRolesHeader(undefined).size).toBe(0);
    expect(parseRolesHeader('').size).toBe(0);
  });

  it('isOperatorTier returns true if any role is operator-class', () => {
    expect(isOperatorTier(new Set<Role>(['operator']))).toBe(true);
    expect(isOperatorTier(new Set<Role>(['auditor']))).toBe(true);
    expect(isOperatorTier(new Set<Role>(['council_member']))).toBe(true);
    expect(isOperatorTier(new Set<Role>(['civil_society']))).toBe(false);
    expect(isOperatorTier(new Set<Role>())).toBe(false);
  });

  it('isOperatorTier returns true when civil_society is mixed with an operator role', () => {
    expect(isOperatorTier(new Set<Role>(['civil_society', 'operator']))).toBe(true);
  });
});
