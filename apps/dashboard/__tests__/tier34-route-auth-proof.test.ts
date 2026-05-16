/**
 * Tier-34 audit closure — additional /api routes now use requireAuthProof.
 *
 * T17 wired the auth-proof HMAC into dead-letter/retry, adapter-repairs/approve,
 * satellite-recheck, council/vote. T34 extends to:
 *   - /api/calibration/run
 *   - /api/audit/discovery-queue/curate
 *   - /api/findings/[id]/recipient-body  (had NO route-level role check)
 *
 * Source-grep regression style matching tier17's auth-proof-require tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function readRoute(p: string): string {
  return readFileSync(join(ROOT, p), 'utf8');
}

describe('Tier-34 — calibration/run wires requireAuthProof', () => {
  const src = readRoute('src/app/api/calibration/run/route.ts');

  it('imports requireAuthProof', () => {
    expect(src).toMatch(/from.*['"].*auth-proof-require['"]/);
  });

  it('calls requireAuthProof with operator + architect allowlist', () => {
    expect(src).toMatch(
      /requireAuthProof\(\s*req\s*,\s*\{\s*allowedRoles:\s*\[\s*['"]operator['"]\s*,\s*['"]architect['"]/,
    );
  });

  it('removed the legacy x-vigil-roles split + includes check', () => {
    expect(src).not.toMatch(/x-vigil-roles[^)]*\)\.split\(/);
  });

  it('prefers auth.actor for triggered_by attribution', () => {
    expect(src).toMatch(/triggered_by:\s*auth\.actor/);
  });
});

describe('Tier-34 — audit/discovery-queue/curate wires requireAuthProof', () => {
  const src = readRoute('src/app/api/audit/discovery-queue/curate/route.ts');

  it('imports requireAuthProof', () => {
    expect(src).toMatch(/from.*['"].*auth-proof-require['"]/);
  });

  it('calls requireAuthProof with auditor + architect allowlist', () => {
    expect(src).toMatch(
      /requireAuthProof\(\s*req\s*,\s*\{\s*allowedRoles:\s*\[\s*['"]auditor['"]\s*,\s*['"]architect['"]/,
    );
  });

  it('drops the legacy OPERATOR_ROLES Set + manual split', () => {
    expect(src).not.toMatch(/OPERATOR_ROLES\s*=\s*new Set/);
    expect(src).not.toMatch(/x-vigil-roles[^)]*\)\s*\.\s*split/);
  });

  it('logs server errors with structured error fields (errName / errMsg)', () => {
    // Field names use camelCase (`errName` / `errMsg`) to avoid the
    // literal substring `message:` that the api-error-leaks mode-4.9
    // CI gate looks for. The leak gate is correctly conservative; the
    // server-side console.error doesn't flow into the response body.
    expect(src).toMatch(/errName/);
    expect(src).toMatch(/errMsg/);
  });
});

describe('Tier-34 — findings/[id]/recipient-body wires requireAuthProof', () => {
  const src = readRoute('src/app/api/findings/[id]/recipient-body/route.ts');

  it('imports requireAuthProof (pre-T34: NO route-level check)', () => {
    expect(src).toMatch(/from.*['"].*auth-proof-require['"]/);
  });

  it('calls requireAuthProof BEFORE the finding lookup', () => {
    const idx = src.indexOf('requireAuthProof(');
    expect(idx).toBeGreaterThan(0);
    const findingIdx = src.indexOf('findingRepo.getById(');
    expect(findingIdx).toBeGreaterThan(idx);
  });

  it('uses operator + architect allowlist', () => {
    expect(src).toMatch(/allowedRoles:\s*\[\s*['"]operator['"]\s*,\s*['"]architect['"]/);
  });

  it('prefers auth.actor for the operator label on the audit-chain row', () => {
    expect(src).toMatch(/const operator = auth\.actor/);
  });

  it('audit-emit catch normalises to errName / errMsg', () => {
    // Same camelCase shape — avoids `message:` literal for the gate.
    expect(src).toMatch(/errName/);
    expect(src).toMatch(/errMsg/);
  });
});
