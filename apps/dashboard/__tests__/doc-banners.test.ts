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

describe('AUDIT-074 — patterns INDEX matches the doc directory', () => {
  it('docs/patterns/INDEX.md exists and lists exactly 43 P-*.md entries', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const indexText = await readFile(docPath('docs/patterns/INDEX.md'), 'utf8');
    const dirEntries = await readdir(docPath('docs/patterns'));
    const patternDocs = dirEntries.filter((f) => /^P-[A-H]-\d{3}\.md$/.test(f)).sort();

    expect(patternDocs.length).toBe(43);
    // Every pattern file must appear as a link target in the index.
    for (const file of patternDocs) {
      expect(indexText).toContain(`./${file}`);
    }
    // INDEX explicitly states the total.
    expect(indexText).toMatch(/Total[^\n]*43 patterns/);
    // Mapping table covers every category A..H present on disk.
    expect(indexText).toMatch(/category-a/);
    expect(indexText).toMatch(/category-h/);
  });
});

describe('AUDIT-072 — SRD §10.2 erratum cross-references TRUTH.md', () => {
  it('SRD-v3.md §10.2 contains the AUDIT-072 erratum banner', () => {
    const text = readFileSync(docPath('docs/source/SRD-v3.md'), 'utf8');
    expect(text).toMatch(/Erratum \(AUDIT-072\):/);
    expect(text).toMatch(/TRUTH\.md.*authoritative/);
    expect(text).toMatch(/DECISION-008/);
  });

  it('TRUTH.md §C still records 27 sources (the canonical count)', () => {
    const text = readFileSync(docPath('TRUTH.md'), 'utf8');
    expect(text).toMatch(/Source count[^\n]*27/);
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
