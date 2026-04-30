import Link from 'next/link';

/**
 * Top navigation. Rendered by the root layout so every page gets a
 * consistent operator-room header. Active styling is per-segment via
 * the `currentPath` prop passed from the layout / per-page wrapper.
 *
 * Two link groups:
 *   - operator: triage / findings / dead-letter / calibration
 *   - civic:    council / public verify / public ledger / submit a tip
 *
 * Keyboard navigable + screen-reader-friendly (semantic <nav>, aria-label
 * on the list, aria-current on the active link).
 */
const OPERATOR_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/findings', label: 'Findings' },
  { href: '/triage/tips', label: 'Tip triage' },
  { href: '/triage/adapter-repairs', label: 'Adapter repairs' },
  { href: '/dead-letter', label: 'Dead-letter' },
  { href: '/calibration', label: 'Calibration' },
  { href: '/audit/ai-safety', label: 'AI safety audit' },
];

const CIVIC_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/council/proposals', label: 'Council' },
  { href: '/civil-society/audit-log', label: 'Civil society' },
  { href: '/public/audit', label: 'Public audit' },
  { href: '/verify', label: 'Verify' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/tip', label: 'Submit a tip' },
];

export function NavBar({ currentPath = '/' }: { currentPath?: string }): JSX.Element {
  const isActive = (href: string): boolean =>
    href === '/' ? currentPath === '/' : currentPath.startsWith(href);

  return (
    <nav className="vigil-nav" aria-label="primary">
      <Link href="/" className="vigil-brand">
        <span aria-hidden="true">●</span>
        <span>VIGIL APEX</span>
      </Link>
      <ul role="list" aria-label="operator">
        {OPERATOR_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={isActive(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
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
