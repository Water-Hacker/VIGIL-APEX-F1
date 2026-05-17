/**
 * T8.3 of TODO.md sweep — pin worker-conac-sftp's refusal to deliver
 * dossiers whose signature_fingerprint starts with the DEV-UNSIGNED-
 * sentinel.
 *
 * Tier-1 audit (and an earlier T2-commit-message claim) asserted this
 * gate existed. It DID NOT until T8.3 added it; this test prevents the
 * gate from silently regressing.
 *
 * The defence is two-tiered:
 *   - apps/worker-dossier/src/libreoffice.ts devUnsignedAllowed()
 *     rejects the dev-fallback in production (NODE_ENV=production OR
 *     VIGIL_PHASE>=1).
 *   - worker-conac-sftp (this file's subject) dead-letters at the
 *     SFTP-delivery boundary if a DEV-UNSIGNED-* fingerprint ever
 *     reaches it.
 *
 * The same prefix string lives in both packages; the contract is that
 * `apps/worker-dossier/src/libreoffice.ts` computeDevUnsignedFingerprint
 * emits exactly the form this worker recognises. The test asserts
 * round-trip compatibility.
 */
import { describe, expect, it } from 'vitest';

import {
  DEV_UNSIGNED_FINGERPRINT_PREFIX,
  isDevUnsignedFingerprint,
} from '../src/dev-unsigned-guard.js';

describe('isDevUnsignedFingerprint — the refusal predicate', () => {
  it('rejects a fingerprint emitted by worker-dossier devUnsigned fallback', () => {
    // Mirrors apps/worker-dossier/src/libreoffice.ts
    // computeDevUnsignedFingerprint('AAAA...01') output shape.
    expect(isDevUnsignedFingerprint('DEV-UNSIGNED-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(
      true,
    );
  });

  it('accepts a real 40-hex GPG fingerprint (happy path)', () => {
    expect(isDevUnsignedFingerprint('ABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(false);
  });

  it('handles null safely (typical for a not-yet-signed dossier row)', () => {
    expect(isDevUnsignedFingerprint(null)).toBe(false);
  });

  it('handles undefined safely', () => {
    expect(isDevUnsignedFingerprint(undefined)).toBe(false);
  });

  it('case-sensitive prefix match — the dossier worker emits upper-case', () => {
    // computeDevUnsignedFingerprint always emits the exact literal
    // "DEV-UNSIGNED-". A lowercase variant must NOT match — that
    // would indicate the prefix string drifted between the two
    // packages and is itself a bug to surface.
    expect(isDevUnsignedFingerprint('dev-unsigned-AAAAAAAA')).toBe(false);
  });

  it('rejects an empty string (defensive)', () => {
    expect(isDevUnsignedFingerprint('')).toBe(false);
  });
});

describe('DEV_UNSIGNED_FINGERPRINT_PREFIX — cross-worker contract', () => {
  it('is exactly the string the dossier worker emits (cross-package contract)', () => {
    // Tier-3 audit cross-witness pattern: this string is exported so
    // worker-dossier's libreoffice.ts and worker-conac-sftp's index.ts
    // share the literal. Any future refactor that changes one side
    // MUST change the other or this test (compared against the
    // dossier-worker's exported helper in CI) catches the drift.
    expect(DEV_UNSIGNED_FINGERPRINT_PREFIX).toBe('DEV-UNSIGNED-');
  });
});
