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
