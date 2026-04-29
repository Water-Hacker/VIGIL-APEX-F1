/**
 * YubiKey signer interface — TAL-PA doctrine §"What each audit record
 * contains" → digital_signature.
 *
 * Production wiring lives outside this package (the YubiKey PKCS#11
 * adapter in the host service), but the SDK accepts the signer through
 * an interface so the emitter can be exercised in tests against a
 * deterministic mock.
 */

export interface AuditSigner {
  /** Returns the actor's hex-encoded signature over `recordHash`. Should
   *  return null if the actor has no enrolled key (system / public). */
  sign(opts: { actorId: string; recordHash: string }): Promise<string | null>;
  /** Returns the YubiKey serial used for the most recent sign() — exposed
   *  on `ActorContext.actor_yubikey_serial`. */
  serial(actorId: string): Promise<string | null>;
}

/** Test/CI signer — produces a deterministic, non-secret pseudo-signature
 *  derived from (actorId, recordHash). */
export class DeterministicTestSigner implements AuditSigner {
  async sign({ actorId, recordHash }: { actorId: string; recordHash: string }): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(`${actorId}|${recordHash}|test-signer`).digest('hex');
  }
  async serial(actorId: string): Promise<string | null> {
    return `TEST-YK-${createSerialFor(actorId)}`;
  }
}

function createSerialFor(actorId: string): string {
  let h = 0;
  for (let i = 0; i < actorId.length; i++) h = ((h << 5) - h + actorId.charCodeAt(i)) | 0;
  return Math.abs(h).toString().padStart(7, '0').slice(0, 7);
}

/** No-op signer for `system:` actors and public visitors. */
export class NoopSigner implements AuditSigner {
  async sign(): Promise<string | null> {
    return null;
  }
  async serial(): Promise<string | null> {
    return null;
  }
}
