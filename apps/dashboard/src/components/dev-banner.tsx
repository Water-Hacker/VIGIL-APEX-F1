/**
 * Persistent dev-mode banner — renders a high-contrast strip across
 * the top of every dashboard page when ANY non-production
 * cryptographic substitute is active.
 *
 * Closes FIND-016 from whole-system-audit doc 10. Under the current
 * implementation (FIND-007 closure) the YubiKey-backed signer cannot
 * be replaced with the dev `LocalWalletAdapter` in production code
 * paths — there is no environment-variable flip. The banner therefore
 * remains inert today. If a future feature ever introduces a
 * dev-substitution path (e.g. LLM offline mode, mocked Fabric peer
 * for staging), set the corresponding `NEXT_PUBLIC_VIGIL_DEV_*` flag
 * to surface this banner.
 *
 * Server component — reads `headers()` once per request. Renders to a
 * `role="status"` landmark for screen readers; visual style is a
 * diagonal-stripe yellow/black strip matching the classification
 * banner aesthetic from SRD §15.
 */
import { headers } from 'next/headers';

import type { JSX } from 'react';

interface BannerCondition {
  readonly key: string;
  readonly when: 'truthy' | 'eq';
  readonly value?: string;
  readonly label: string;
}

/**
 * SINGLE SOURCE OF TRUTH for what triggers the banner. Add a new row
 * here when introducing a new dev-substitution path; the banner will
 * then render whenever that env flag is set.
 *
 * NEXT_PUBLIC_* prefix is required so the value is readable from the
 * browser (Next.js strips other env vars from the client bundle).
 */
const TRIGGERS: ReadonlyArray<BannerCondition> = [
  {
    key: 'NEXT_PUBLIC_VIGIL_DEV_MODE',
    when: 'truthy',
    label: 'DEV MODE — non-production cryptographic substitute active',
  },
  {
    key: 'NEXT_PUBLIC_VIGIL_FABRIC_MOCK',
    when: 'truthy',
    label: 'FABRIC PEER MOCKED — chaincode writes do not reach a real ledger',
  },
  {
    key: 'NEXT_PUBLIC_VIGIL_LLM_OFFLINE',
    when: 'truthy',
    label: 'LLM OFFLINE — extraction + counter-evidence are stubbed',
  },
];

function activeTriggers(): ReadonlyArray<string> {
  const out: string[] = [];
  for (const t of TRIGGERS) {
    const v = process.env[t.key];
    if (t.when === 'truthy' && v && v !== '0' && v.toLowerCase() !== 'false') {
      out.push(t.label);
    } else if (t.when === 'eq' && v === t.value) {
      out.push(t.label);
    }
  }
  return out;
}

export function DevBanner(): JSX.Element | null {
  const active = activeTriggers();
  if (active.length === 0) return null;
  // Read headers so this component is a true server component (avoids
  // accidental static rendering on prerendered routes).
  headers();

  return (
    <div
      role="status"
      aria-live="polite"
      className="vigil-dev-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        padding: '6px 12px',
        background: 'repeating-linear-gradient(45deg, #facc15 0 12px, #1f2937 12px 24px)',
        color: '#fff',
        fontWeight: 600,
        fontSize: '0.875rem',
        textAlign: 'center',
        boxShadow: '0 1px 0 rgba(0,0,0,0.25)',
      }}
    >
      <span
        style={{
          background: '#1f2937',
          padding: '2px 8px',
          borderRadius: 4,
        }}
      >
        {active.join(' · ')}
      </span>
    </div>
  );
}
