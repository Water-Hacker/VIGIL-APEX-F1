import { ROLES, type Role } from '@vigil/security';

import { ROUTE_RULES } from '../../../middleware';

import type { Metadata } from 'next';

/**
 * Live RBAC matrix screen — read-only view of the SINGLE SOURCE OF
 * TRUTH for authorization (middleware ROUTE_RULES).
 *
 * Closes FIND-009 (whole-system-audit doc 10): per the audit spec
 * § 7.1, the platform must provide a live screen that renders the
 * same data the build-time tooling reads. Importing `ROUTE_RULES`
 * directly from middleware.ts guarantees zero drift — there is no
 * second copy.
 *
 * Gated by middleware ROUTE_RULES `{ prefix: '/audit', allow:
 * ['auditor', 'architect'] }`; an operator without `auditor` or
 * `architect` cannot reach this page.
 *
 * Static — runs at request time and reads no database. Suitable for
 * institutional reviewers and external red-teamers to inspect the
 * authorization surface in one view.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VIGIL APEX — RBAC matrix',
  description: 'Authorization matrix — single source of truth from middleware.',
};

interface MatrixCell {
  readonly prefix: string;
  readonly role: Role;
  readonly allowed: boolean;
}

function buildMatrix(): { rules: typeof ROUTE_RULES; cells: ReadonlyArray<MatrixCell> } {
  const cells: MatrixCell[] = [];
  for (const rule of ROUTE_RULES) {
    for (const role of ROLES) {
      cells.push({
        prefix: rule.prefix,
        role,
        allowed: rule.allow.includes(role),
      });
    }
  }
  return { rules: ROUTE_RULES, cells };
}

export default function RbacMatrixPage(): JSX.Element {
  const { rules } = buildMatrix();

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">RBAC matrix</h1>
        <p className="text-sm text-gray-700">
          Source: <code>apps/dashboard/src/middleware.ts</code> · ROUTE_RULES. Every column is a
          Keycloak role; every row is a URL prefix the dashboard enforces.{' '}
          <strong>This is read directly from the middleware module</strong>, so the table cannot
          drift from runtime enforcement.
        </p>
        <p className="text-xs text-gray-500">
          Closes FIND-009 from the whole-system audit. The build-time coverage check (FIND-004)
          additionally enforces that every operator page on disk maps to one of the prefixes here.
        </p>
      </header>

      <section aria-label="role-route matrix">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="text-left font-semibold border-b border-gray-300 p-2 align-bottom"
              >
                URL prefix
              </th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="text-center font-semibold border-b border-gray-300 p-2 align-bottom"
                  aria-label={role}
                >
                  <span className="text-xs">{role.replace('_', ' ')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.prefix}>
                <th scope="row" className="text-left font-mono border-b border-gray-200 p-2">
                  {rule.prefix}
                </th>
                {ROLES.map((role) => {
                  const allowed = rule.allow.includes(role);
                  return (
                    <td
                      key={role}
                      className="text-center border-b border-gray-200 p-2"
                      aria-label={
                        allowed
                          ? `${role} is allowed on ${rule.prefix}`
                          : `${role} is denied on ${rule.prefix}`
                      }
                    >
                      {allowed ? (
                        <span className="text-green-700" aria-hidden="true">
                          ✓
                        </span>
                      ) : (
                        <span className="text-gray-400" aria-hidden="true">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="text-xs text-gray-600 space-y-1">
        <h2 className="font-semibold text-sm text-gray-800">Notes</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Roles are enumerated by <code>@vigil/security/roles</code> ({ROLES.length} total).
          </li>
          <li>
            A user with multiple roles is allowed if ANY of their roles is in the rule&apos;s
            allow-list.
          </li>
          <li>
            Public surfaces (/, /tip, /verify, /ledger, /public, /privacy, /terms) bypass the rule
            table; they are enumerated in middleware.ts PUBLIC_PREFIXES.
          </li>
        </ul>
      </section>
    </main>
  );
}
