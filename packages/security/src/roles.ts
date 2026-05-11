/**
 * Role registry — single source of truth for every Keycloak role the
 * dashboard recognises.
 *
 * Closes FIND-008 (whole-system-audit doc 10). Previously roles were bare
 * string literals scattered across middleware.ts and consumer pages; a
 * typo in any one allow-list would silently lock out the entire role
 * with no compile-time signal. This module enumerates them once and
 * exports a typed union so TypeScript fails compilation on drift.
 *
 * If you add a Keycloak realm role, add it here AND to the
 * `ROLE_TIER_OPERATOR` set if appropriate — that set is what the navbar
 * and RBAC matrix screen treat as "operator-class" for navigation
 * visibility (FIND-003).
 */

export const ROLES = [
  'operator',
  'auditor',
  'architect',
  'council_member',
  'tip_handler',
  'civil_society',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * "Operator-class" roles — staff with operational responsibilities inside
 * the platform. These are the roles for which the operator navigation
 * group should render. A user with NO operator-class role (or no auth
 * at all) sees only the civic (public) link group.
 */
export const OPERATOR_TIER_ROLES = new Set<Role>([
  'operator',
  'auditor',
  'architect',
  'tip_handler',
  'council_member',
]);

/**
 * Read-only constituency. `civil_society` has access to redacted
 * civil-society views but is NOT considered operator-tier for navigation.
 */
export const READ_ONLY_TIER_ROLES = new Set<Role>(['civil_society']);

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

/** Type guard: is the given string a valid Keycloak role? */
export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/**
 * Parse a comma-separated `x-vigil-roles` header value into a typed set.
 * Unknown role names are dropped (defensive — middleware should already
 * have stripped these, but the consumer is allowed to assume only valid
 * roles enter business logic).
 */
export function parseRolesHeader(header: string | null | undefined): ReadonlySet<Role> {
  if (!header) return new Set();
  const out = new Set<Role>();
  for (const raw of header.split(',')) {
    const trimmed = raw.trim();
    if (isRole(trimmed)) out.add(trimmed);
  }
  return out;
}

/** True if the role set contains at least one operator-class role. */
export function isOperatorTier(roles: ReadonlySet<Role>): boolean {
  for (const r of roles) if (OPERATOR_TIER_ROLES.has(r)) return true;
  return false;
}
