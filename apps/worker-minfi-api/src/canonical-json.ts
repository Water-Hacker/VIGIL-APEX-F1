/**
 * Tier-8 outbound-delivery audit closure — canonical JSON for ECDSA
 * signing and verification on the MINFI scoring API.
 *
 * Plain `JSON.stringify(obj)` is NOT canonical: `{a:1, b:2}` and
 * `{b:2, a:1}` produce different byte sequences for the same JSON
 * value. Signature verification compares byte sequences, so a signer
 * that emits canonical form (RFC-8785 / sorted-keys) and a verifier
 * that uses Node's `JSON.stringify` cannot agree on what was signed
 * unless their key orders happen to match.
 *
 * canonicalJson sorts object keys recursively and uses no-whitespace
 * serialisation. Same shape as packages/audit-chain/src/canonical.ts.
 *
 * Extracted to its own module so unit tests can import without
 * triggering the worker's `main()` at module load.
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeysDeep(obj[k]);
    return out;
  }
  return value;
}
