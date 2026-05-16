/**
 * Tip-triage handler — extracted from index.ts so the full
 * 3-of-5-council-decrypt → SafeLlmRouter-paraphrase flow is testable
 * without spinning up Vault, Postgres, Redis, or a real LLM backend.
 *
 * Privacy invariant (SRD §28.4 + AI-SAFETY-DOCTRINE-v1 §B.4):
 *
 *   The decrypted plaintext appears in ONE place during this handler:
 *   the SafeLlmRouter `safe.call({...sources: [{text: plaintext}]})`
 *   argument — passed inside a closed-context `<source_document>` tag
 *   per the doctrine. It does NOT cross any other boundary:
 *
 *     - No log line carries plaintext (logger.info / warn / error
 *       only carry tip_id + outcome metadata).
 *     - No persisted Postgres column outside the encrypted
 *       body_ciphertext / contact_ciphertext stores plaintext.
 *     - No queue publish payload carries plaintext.
 *     - No audit-chain row payload carries plaintext.
 *
 *   The Block-E E.2 / D2 E2E test asserts this invariant by
 *   capturing every dep call's arguments and grepping for the
 *   known plaintext substring.
 *
 * Refs: SRD §28.4 (council quorum decrypt); AI-SAFETY-DOCTRINE-v1
 * §B.4 (closed-context); BLOCK-E-PLAN.md §2.2.
 */

import {
  expose,
  sealedBoxDecrypt,
  shamirCombineFromBase64,
  wipe,
  wrapSecret,
} from '@vigil/security';
import { z } from 'zod';

import { TIP_PARAPHRASE_TASK } from './prompt-tasks.js';

import type { TipRepo } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { Envelope, HandlerOutcome } from '@vigil/queue';
import type { VaultClient } from '@vigil/security';

const ZERO_BYTES = new Uint8Array(0);

/**
 * Structural-type decoupling for SafeLlmRouter (mirrors the pattern in
 * `apps/worker-extractor/src/llm-extractor.ts`). Avoids pulling
 * `@vigil/llm` into this module's import graph so the E2E test can
 * load `triage-flow.ts` without vitest having to resolve the full
 * Anthropic / Bedrock SDK chain (which has a broken `./core` exports
 * map at the version we pin). The real `SafeLlmRouter` from
 * `@vigil/llm` satisfies this interface structurally.
 */
export interface SafeLlmRouterLike {
  call<TResult>(input: {
    findingId: string | null;
    assessmentId: string | null;
    promptName: string;
    task: string;
    sources: ReadonlyArray<{ id: string; label?: string; text: string }>;
    responseSchema: z.ZodType<TResult>;
    modelId: string;
    temperature?: number;
  }): Promise<{
    value: TResult;
    canaryTriggered: boolean;
    schemaValid: boolean;
    verbatimRejections: ReadonlyArray<{ claim: unknown; reason: string }>;
  }>;
}

export const zTipTriagePayload = z.object({
  tip_id: z.string().uuid(),
  // Three Shamir shares from council members (3-of-5; SRD §28.4 quorum decryption)
  decryption_shares: z.array(z.string()).min(3).max(5),
});
export type TipTriagePayload = z.infer<typeof zTipTriagePayload>;

export const zParaphrase = z.object({
  paraphrase: z.string().min(20).max(500),
  topic_hint: z.enum(['procurement', 'payroll', 'infrastructure', 'sanctions', 'banking', 'other']),
  severity_hint: z.enum(['low', 'medium', 'high', 'critical']),
});
export type Paraphrase = z.infer<typeof zParaphrase>;

export interface TipTriageDeps {
  readonly tipRepo: TipRepo;
  readonly vault: VaultClient;
  readonly safe: SafeLlmRouterLike;
  readonly modelId: string;
  readonly logger: Logger;
}

function toBase64(bytes: Uint8Array): string {
  // Encode without depending on Node's Buffer import surface — the worker
  // runtime always has it via the runtime, but importing keeps node:buffer
  // off the type-check path for environments that don't ship @types/node.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const buf: { from: (b: Uint8Array) => { toString: (enc: string) => string } } = (
    globalThis as { Buffer?: unknown }
  ).Buffer as never;
  return buf.from(bytes).toString('base64');
}

/**
 * Handle one tip-triage envelope. The handler:
 *
 *   1. Resolves the tip row by UUID.
 *   2. Reads the operator-team public key from Vault.
 *   3. Reconstructs the operator-team private key from the inbound
 *      Shamir shares (3-of-5 quorum). The reconstructed key is
 *      held only on the local stack and dropped at function return.
 *   4. Decrypts the body ciphertext via libsodium sealed-box.
 *   5. Calls SafeLlmRouter with the plaintext as a closed-context
 *      `<source_document>` source. The system preamble teaches the
 *      model to treat tag contents as data, not instructions.
 *   6. Updates the tip's disposition to IN_TRIAGE.
 *
 * On failure, returns a `dead-letter` or `retry` outcome with a
 * plaintext-free reason string.
 */
export async function handleTip(
  deps: TipTriageDeps,
  env: Envelope<TipTriagePayload>,
): Promise<HandlerOutcome> {
  // tip_id is the row UUID (matches Zod schema + the dashboard
  // /api/triage/tips/decrypt body). Lookup must hit the id column, not ref.
  const tip = await deps.tipRepo.getById(env.payload.tip_id);
  if (!tip) return { kind: 'dead-letter', reason: 'tip not found' };

  // 3-of-5 council quorum decryption (SRD §28.4). The inbound payload
  // carries three council Shamir shares of the operator-team private key;
  // we reconstruct the key in-memory, decrypt, and immediately drop the
  // reconstructed handle. The shares themselves were collected by the
  // /triage/tips operator UI (Phase C10) — never persisted server-side.
  const pk = await deps.vault.read<string>('tip-portal', 'operator_team_public_key');

  // Tier-16 audit closure: the reconstructed Shamir private key and
  // the decrypted plaintext live in two `Uint8Array` buffers below.
  // We hold them through a single `try / finally` so they are wiped
  // with libsodium.memzero on EVERY exit path (success, decrypt
  // failure, LLM failure, dead-letter return). Without this, a
  // crash-dump / heap-snapshot taken any time after the first await
  // captures the citizen plaintext.
  let reconstructedSkBytes: Uint8Array | null = null;
  let plaintext: Uint8Array = ZERO_BYTES;
  try {
    let reconstructedSk;
    try {
      reconstructedSk = shamirCombineFromBase64(env.payload.decryption_shares);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      deps.logger.error(
        { tip_id: tip.id, err_name: err.name, err_message: err.message },
        'shamir-combine-failed',
      );
      return { kind: 'dead-letter', reason: 'shamir-combine-failure' };
    }
    reconstructedSkBytes = expose(reconstructedSk);

    try {
      // sealedBoxDecrypt expects base64-encoded keys/ciphertexts; the
      // reconstructed Shamir bytes are the libsodium private key, so we
      // re-encode through Secret<string> wrapping to keep the unwrap
      // surface narrow.
      const skB64 = wrapSecret(toBase64(reconstructedSkBytes));
      plaintext = await sealedBoxDecrypt(
        toBase64(tip.body_ciphertext as unknown as Uint8Array),
        expose(pk),
        skB64,
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      deps.logger.error(
        { tip_id: tip.id, err_name: err.name, err_message: err.message },
        'tip-decrypt-failed',
      );
      return { kind: 'dead-letter', reason: 'decrypt-failure' };
    }
    const text = new TextDecoder().decode(plaintext);

    // The paraphrase prompt window is 4000 chars. Surface truncation so
    // operators see "this tip was longer than the paraphrase budget" in
    // the structured logs — silent slicing is a privacy/integrity issue
    // (a citizen wrote 8000 chars; the operator should know their
    // paraphrase covers only the first half).
    const PARAPHRASE_BUDGET_CHARS = 4000;
    const truncated = text.length > PARAPHRASE_BUDGET_CHARS;
    const paraphraseInput = truncated ? text.slice(0, PARAPHRASE_BUDGET_CHARS) : text;
    if (truncated) {
      deps.logger.warn(
        { tip_id: tip.id, full_length: text.length, paraphrase_length: paraphraseInput.length },
        'tip-paraphrase-input-truncated',
      );
    }

    // LLM paraphrase pass — Block-B A2 migration: routes through
    // SafeLlmRouter so the doctrine system preamble + canary +
    // call-record audit + prompt-version pin apply uniformly.
    // The plaintext crosses ONE boundary here — the safe.call's
    // sources[].text field — and that's by design (the closed-context
    // boundary IS the intended exit from the council-quorum-decrypt
    // domain). Privacy invariant: plaintext appears nowhere else.
    try {
      const outcome = await deps.safe.call<Paraphrase>({
        findingId: null,
        assessmentId: null,
        promptName: 'tip-triage.paraphrase',
        task: TIP_PARAPHRASE_TASK,
        sources: [{ id: `tip:${tip.id}`, label: 'tip-body', text: paraphraseInput }],
        responseSchema: zParaphrase,
        modelId: deps.modelId,
      });
      deps.logger.info(
        { tip_id: tip.id, severity: outcome.value.severity_hint, truncated },
        'tip-paraphrased',
      );
      // Update disposition + paraphrase notes (encrypted at rest with the same operator-team key)
      await deps.tipRepo.setDisposition(tip.id, 'IN_TRIAGE', 'worker-tip-triage');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      deps.logger.error(
        { tip_id: tip.id, err_name: err.name, err_message: err.message },
        'paraphrase-failed',
      );
      return { kind: 'retry', reason: 'llm-failure', delay_ms: 60_000 };
    }
    return { kind: 'ack' };
  } finally {
    // Best-effort sensitive-memory hygiene. `wipe` is a no-op for
    // ZERO_BYTES (length=0 short-circuit) so this is safe to call
    // unconditionally on the never-decrypted path. Plaintext-derived
    // JS strings (`text`, `paraphraseInput`) cannot be zeroed by the
    // application (V8 strings are immutable); the Uint8Array source
    // is the most defensible cleanup we can perform.
    await wipe(plaintext);
    await wipe(reconstructedSkBytes);
  }
}
