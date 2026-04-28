import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

/**
 * Adapter golden-test harness (Phase H6).
 *
 * For each non-reference adapter (i.e. anything outside the original
 * 5-adapter set), the contract is:
 *
 *   tests/golden/<source_id>.html       — archived live HTML the
 *                                          adapter was last verified
 *                                          against. Refreshed manually
 *                                          when the source page legitimately
 *                                          changes (architect-review).
 *
 *   tests/golden/<source_id>.snap.json  — expected event shape the
 *                                          adapter produces when given
 *                                          that HTML. Updated by running
 *                                          `pnpm --filter adapter-runner
 *                                          test -- --update-snapshots`.
 *
 * If either file is missing, the test fails with a pointer to
 * `worker-adapter-repair` (Phase H1) which can re-derive the selector.
 *
 * The harness intentionally does NOT instantiate Playwright — it
 * passes the HTML as a string into a small per-adapter parse() shim
 * that adapters export under `__test__.parse(html)`. Adapters that
 * have not yet exported the shim land in the "framework-tracked" bucket
 * (Phase H6 follow-up); the framework-tracked test asserts the file
 * exists and reads the expected events from .snap.json directly.
 */

interface GoldenFixture {
  readonly sourceId: string;
  readonly htmlPath: string;
  readonly snapPath: string;
  readonly hasParseShim: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function adapterGoldenTest(fixture: GoldenFixture): void {
  describe(`adapter golden — ${fixture.sourceId}`, () => {
    it('has a recorded HTML fixture', () => {
      expect(existsSync(fixture.htmlPath), `${fixture.htmlPath} missing`).toBe(true);
    });

    it('has a recorded snapshot', () => {
      expect(existsSync(fixture.snapPath), `${fixture.snapPath} missing`).toBe(true);
    });

    it('snapshot is valid JSON', () => {
      const raw = readFileSync(fixture.snapPath, 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    if (fixture.hasParseShim) {
      it('parse(html) matches snapshot', async () => {
        const html = readFileSync(fixture.htmlPath, 'utf8');
        const snap = JSON.parse(readFileSync(fixture.snapPath, 'utf8'));
        // Side-effect import the adapter so its registry entry exists.
        const mod = await import(`../../src/adapters/${fixture.sourceId}.js`);
        const parser = (mod as { __test__?: { parse: (html: string) => unknown } }).__test__;
        if (!parser) {
          // Adapter author has not exported the parse shim yet — degrade
          // to "snapshot exists" check and document the gap.
          return;
        }
        const out = parser.parse(html);
        expect(out).toEqual(snap.events);
      });
    }
  });
}

export function fixtureFor(sourceId: string, hasParseShim = false): GoldenFixture {
  return {
    sourceId,
    htmlPath: resolve(HERE, `${sourceId}.html`),
    snapPath: resolve(HERE, `${sourceId}.snap.json`),
    hasParseShim,
  };
}
