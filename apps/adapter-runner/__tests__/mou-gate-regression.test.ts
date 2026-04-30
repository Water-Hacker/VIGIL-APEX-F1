/**
 * AUDIT-001 / AUDIT-002 / AUDIT-003 — MOU-gated adapters refuse to run
 * when *_ENABLED=1 but *_MOU_ACK is not "1".
 *
 * The adapters extend `Adapter.execute` as `protected`, so this is a
 * source-grep regression test (precedent: dashboard
 * post-route-validation tests for AUDIT-008/-009). It pins the throw
 * line in each of the three adapter files; a future PR that removes
 * or weakens the guard fails here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface GuardSpec {
  audit: string;
  file: string;
  enabledFlag: string;
  ackFlag: string;
  source: string;
}

const SPECS: ReadonlyArray<GuardSpec> = [
  {
    audit: 'AUDIT-001',
    file: 'apps/adapter-runner/src/adapters/minfi-bis.ts',
    enabledFlag: 'MINFI_BIS_ENABLED',
    ackFlag: 'MINFI_BIS_MOU_ACK',
    source: 'minfi-bis',
  },
  {
    audit: 'AUDIT-002',
    file: 'apps/adapter-runner/src/adapters/beac-payments.ts',
    enabledFlag: 'BEAC_ENABLED',
    ackFlag: 'BEAC_MOU_ACK',
    source: 'beac-payments',
  },
  {
    audit: 'AUDIT-003',
    file: 'apps/adapter-runner/src/adapters/anif-amlscreen.ts',
    enabledFlag: 'ANIF_ENABLED',
    ackFlag: 'ANIF_MOU_ACK',
    source: 'anif-amlscreen',
  },
];

describe('AUDIT-001/-002/-003 — MOU-gated adapters refuse to run without *_MOU_ACK=1', () => {
  for (const spec of SPECS) {
    it(`${spec.audit} — ${spec.source} guards on ${spec.ackFlag}`, () => {
      const text = readFileSync(join(REPO_ROOT, spec.file), 'utf8');
      // The ENABLED check must still be there (early return on disabled).
      expect(text).toMatch(new RegExp(`process\\.env\\.${spec.enabledFlag}\\s*!==\\s*['"]1['"]`));
      // The MOU_ACK check must throw, not return.
      expect(text).toMatch(new RegExp(`process\\.env\\.${spec.ackFlag}\\s*!==\\s*['"]1['"]`));
      // Refuse-to-run language must appear in the diagnostic.
      expect(text).toMatch(/refusing to run before the MOU is countersigned/);
    });
  }
});
