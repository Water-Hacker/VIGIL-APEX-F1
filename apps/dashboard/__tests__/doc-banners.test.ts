/**
 * Documentation-banner regression tests.
 *
 * Some doc sections carry STATUS banners that other Phase-2 audit
 * findings rely on (e.g. "deferred-to-M3" markers, PROVISIONAL
 * decision warnings). Removing those banners silently is a docs-drift
 * regression — this file fails CI if any of them disappears.
 *
 * Add a new banner check here whenever a documentation-only audit
 * finding closes and the closure depends on a banner being present.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const docPath = (rel: string) => path.join(REPO_ROOT, rel);

describe('AUDIT-017 — HSK §4.8 native PKCS#11 vote-signer is marked deferred', () => {
  it('docs/source/HSK-v1.md contains the §4.8 deferred banner', () => {
    const text = readFileSync(docPath('docs/source/HSK-v1.md'), 'utf8');
    // The banner must call out: deferred-to-M3 / WebAuthn fallback /
    // an architect-signoff requirement to remove. If a future PR
    // shortens the section, all three substrings must remain.
    expect(text).toMatch(/4\.8\s+Council Vote Signing[^\n]*PKCS#11/i);
    expect(text).toMatch(/STATUS:\s*deferred-to-M3/);
    expect(text).toMatch(/WebAuthn fallback/);
    expect(text).toMatch(/architect signoff/i);
  });
});

describe('AUDIT-018 — worker-fabric-bridge README documents single-peer status', () => {
  it('apps/worker-fabric-bridge/README.md contains the multi-org-deferred status banner', () => {
    const text = readFileSync(docPath('apps/worker-fabric-bridge/README.md'), 'utf8');
    expect(text).toMatch(/single-peer through Phase 1/i);
    expect(text).toMatch(/multi-org deferred to Phase 2/i);
    expect(text).toMatch(/DECISION-004/);
    // The Phase-2 checklist must remain — these are the institutional
    // pre-reqs the architect tracks. If a PR removes them, this fails.
    expect(text).toMatch(/CONAC engagement letter/i);
    expect(text).toMatch(/Cour des Comptes/i);
    expect(text).toMatch(/Endorsement policy/i);
  });
});

describe('AUDIT-071 — every PROVISIONAL decision in log.md has the body-is-forward-looking banner', () => {
  it('the count of "### Decision (proposed)" sections == count of PROVISIONAL banners', () => {
    const text = readFileSync(docPath('docs/decisions/log.md'), 'utf8');
    const proposedHeadings = text.match(/^### Decision \(proposed\)$/gm) ?? [];
    const banners =
      text.match(
        /STATUS: PROVISIONAL — body is forward-looking; ratification pending architect read-through\. Do not cite as authoritative for new PRs\.\*\* \(AUDIT-071\)/g,
      ) ?? [];
    // Every "Decision (proposed)" subheading must be preceded by the
    // AUDIT-071 banner.
    expect(proposedHeadings.length).toBeGreaterThan(0);
    expect(banners.length).toBe(proposedHeadings.length);
  });

  it('the banner appears immediately before each "Decision (proposed)" subheading', () => {
    const text = readFileSync(docPath('docs/decisions/log.md'), 'utf8');
    // Match the canonical pattern: banner blockquote, blank line, heading.
    // Banner format:
    //   > **STATUS: PROVISIONAL — body is forward-looking; ... PRs.** (AUDIT-071)
    const pattern = /\*\*STATUS: PROVISIONAL[^\n]*\*\* \(AUDIT-071\)\n\n### Decision \(proposed\)/g;
    const matches = text.match(pattern) ?? [];
    const proposed = text.match(/^### Decision \(proposed\)$/gm) ?? [];
    expect(matches.length).toBe(proposed.length);
  });
});
