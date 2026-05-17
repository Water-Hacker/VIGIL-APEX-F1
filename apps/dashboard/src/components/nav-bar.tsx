import Link from 'next/link';

/**
 * Top navigation. Rendered by the root layout so every page gets a
 * consistent operator-room header. Active styling is per-segment via
 * the `currentPath` prop passed from the layout.
 *
 * Two link groups:
 *   - operator: triage / findings / dead-letter / calibration / audit
 *               — RENDERED ONLY when the caller has at least one
 *                 operator-class role (FIND-003 closure, audit doc 10).
 *   - civic:    council / public verify / public ledger / submit a tip
 *               — always rendered.
 *
 * Keyboard navigable + screen-reader-friendly (semantic <nav>, aria-label
 * on the list, aria-current on the active link).
 */
const OPERATOR_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/findings', label: 'Findings' },
  { href: '/regions', label: 'Regional map' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/triage/tips', label: 'Tip triage' },
  { href: '/triage/adapter-repairs', label: 'Adapter repairs' },
  { href: '/dead-letter', label: 'Dead-letter' },
  { href: '/calibration', label: 'Calibration' },
  { href: '/audit/ai-safety', label: 'AI safety audit' },
  // FIND-009 closure: live RBAC matrix screen, gated for auditor/architect
  // by middleware. Visible in operator nav for the same tier.
  { href: '/audit/rbac-matrix', label: 'RBAC matrix' },
  // FRONTIER-AUDIT E1.1 third-element closure: curation queue for
  // worker-pattern-discovery output. Gated for auditor/architect.
  { href: '/audit/discovery-queue', label: 'Discovery queue' },
];

const CIVIC_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/council/proposals', label: 'Council' },
  { href: '/civil-society/audit-log', label: 'Civil society' },
  { href: '/public/audit', label: 'Public audit' },
  { href: '/verify', label: 'Verify' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/tip', label: 'Submit a tip' },
];

export interface NavBarProps {
  readonly currentPath?: string;
  /** True when the request carried at least one operator-tier role
   *  (operator, auditor, architect, council_member, tip_handler).
   *  Determined by the root layout from the middleware-set
   *  `x-vigil-roles` header. Closes FIND-003 — public users can no
   *  longer enumerate operator routes from the nav bar. */
  readonly isOperator?: boolean;
}

export function NavBar({ currentPath = '/', isOperator = false }: NavBarProps): JSX.Element {
  const isActive = (href: string): boolean =>
    href === '/' ? currentPath === '/' : currentPath.startsWith(href);

  return (
    <nav className="vigil-nav" aria-label="primary">
      <Link href="/" className="vigil-brand">
        <span aria-hidden="true">●</span>
        <span>VIGIL APEX</span>
      </Link>
      {isOperator ? (
        <ul role="list" aria-label="operator">
          {OPERATOR_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={isActive(l.href) ? 'page' : undefined}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <ul role="list" aria-label="civic" className="vigil-nav-civic">
        {CIVIC_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={isActive(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
