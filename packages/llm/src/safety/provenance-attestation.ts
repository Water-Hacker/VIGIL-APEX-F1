/**
 * Layer 14 — Per-claim provenance attestation.
 *
 * Closes FRONTIER-AUDIT Layer-1 E1.3 gap #2: every LLM-derived claim
 * should be tagged with `{model_id, model_version, temperature,
 * prompt_hash, response_hash, timestamp}`. The audit chain currently
 * records the call envelope but not the per-claim provenance, so
 * a CONAC investigator reading a dossier can't trace which model
 * produced which exonerating claim.
 *
 * This module provides the canonical attestation shape + a helper
 * to tag CitedClaim values with their model provenance, plus a
 * verification routine for downstream consumers.
 *
 * The attestation is itself hash-chained into the audit log under
 * `audit.llm_claim_attested`. An external reviewer can replay and
 * confirm that every claim in a delivered dossier traces back to
 * exactly one model call.
 */

import { createHash } from 'node:crypto';

export interface LlmProvenance {
  /** Pinned model identifier as it appears in the provider catalogue. */
  readonly model_id: string;
  /** Specific dated version (e.g., '20241022'). */
  readonly model_version: string;
  /** Pinned temperature for this call. */
  readonly temperature: number;
  /** SHA-256 of the canonical prompt envelope sent to the model. */
  readonly prompt_hash: string;
  /** SHA-256 of the raw model response BEFORE schema parsing. */
  readonly response_hash: string;
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: string;
  /** Provider path: 'anthropic-api' / 'aws-bedrock' / 'mistral-self-hosted'. */
  readonly provider_path: string;
  /** Optional: prompt template name from the system-prompt allowlist. */
  readonly prompt_template?: string;
}

export interface AttestedClaim {
  readonly claim: string;
  readonly provenance: LlmProvenance;
  readonly cited_document_cid?: string;
  readonly cited_page?: number;
  readonly cited_char_span?: readonly [number, number];
}

/** Canonical SHA-256 of a string (or any JSON-able value). */
export function provenanceHash(value: unknown): string {
  const s =
    typeof value === 'string' ? value : JSON.stringify(value, Object.keys(value as object).sort());
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Build a provenance object from a model-call descriptor. */
export function buildProvenance(opts: {
  readonly model_id: string;
  readonly model_version: string;
  readonly temperature: number;
  readonly prompt: string;
  readonly response: string;
  readonly provider_path: string;
  readonly prompt_template?: string;
  readonly clock?: () => Date;
}): LlmProvenance {
  const base = {
    model_id: opts.model_id,
    model_version: opts.model_version,
    temperature: opts.temperature,
    prompt_hash: provenanceHash(opts.prompt),
    response_hash: provenanceHash(opts.response),
    timestamp: (opts.clock?.() ?? new Date()).toISOString(),
    provider_path: opts.provider_path,
  };
  return opts.prompt_template !== undefined
    ? { ...base, prompt_template: opts.prompt_template }
    : base;
}

/** Attach a provenance object to a claim. */
export function attestClaim(
  claim: string,
  provenance: LlmProvenance,
  citation?: { document_cid?: string; page?: number; char_span?: readonly [number, number] },
): AttestedClaim {
  const att: {
    claim: string;
    provenance: LlmProvenance;
    cited_document_cid?: string;
    cited_page?: number;
    cited_char_span?: readonly [number, number];
  } = { claim, provenance };
  if (citation?.document_cid !== undefined) att.cited_document_cid = citation.document_cid;
  if (citation?.page !== undefined) att.cited_page = citation.page;
  if (citation?.char_span !== undefined) att.cited_char_span = citation.char_span;
  return att;
}

/**
 * Verify that an attested claim's provenance fields are present and
 * structurally valid. Does NOT recompute the prompt/response hashes
 * (that requires the original prompt + response, typically retained
 * in the audit chain). Use `verifyProvenanceAgainstOriginals()` for
 * full re-verification.
 */
export function verifyAttestationShape(att: AttestedClaim): {
  valid: boolean;
  issues: ReadonlyArray<string>;
} {
  const issues: string[] = [];
  const p = att.provenance;
  if (!p.model_id || p.model_id.trim() === '') issues.push('model_id missing');
  if (!p.model_version || p.model_version.trim() === '') issues.push('model_version missing');
  if (!Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 1) {
    issues.push(`temperature out of range: ${p.temperature}`);
  }
  if (!/^[0-9a-f]{64}$/.test(p.prompt_hash)) issues.push('prompt_hash not SHA-256 hex');
  if (!/^[0-9a-f]{64}$/.test(p.response_hash)) issues.push('response_hash not SHA-256 hex');
  if (!p.timestamp || isNaN(Date.parse(p.timestamp))) issues.push('timestamp not ISO-8601');
  if (!p.provider_path) issues.push('provider_path missing');
  return { valid: issues.length === 0, issues };
}

/**
 * Re-verify by recomputing hashes from originals. Used by external
 * reviewers replaying the audit chain to confirm a claim's
 * provenance has not been altered.
 */
export function verifyProvenanceAgainstOriginals(
  att: AttestedClaim,
  originals: { prompt: string; response: string },
): { valid: boolean; issues: ReadonlyArray<string> } {
  const shape = verifyAttestationShape(att);
  if (!shape.valid) return shape;
  const issues: string[] = [];
  if (provenanceHash(originals.prompt) !== att.provenance.prompt_hash) {
    issues.push('prompt_hash mismatch — prompt tampered');
  }
  if (provenanceHash(originals.response) !== att.provenance.response_hash) {
    issues.push('response_hash mismatch — response tampered');
  }
  return { valid: issues.length === 0, issues };
}
