import { z } from 'zod';

export const zCandidateSelector = z.object({
  selector: z
    .object({
      type: z.enum(['css', 'xpath', 'json_path']),
      value: z.string().min(1).max(2_000),
      field_paths: z.record(z.string()).default({}),
    })
    .nullable(),
  rationale: z.string().max(500),
  confidence: z.number().min(0).max(1),
});
export type CandidateSelector = z.infer<typeof zCandidateSelector>;

/**
 * Critical adapters require architect approval before promotion.
 * Informational ones auto-promote when shadow tests are clean.
 *
 * Decision: keep this list short and explicit. A misclassified critical
 * adapter is recoverable (manual approval still works); a misclassified
 * informational one would auto-flip an architect-relevant selector
 * with no review.
 */
export const CRITICAL_ADAPTERS: ReadonlySet<string> = new Set([
  'armp-main',
  'armp-historical',
  'dgi-attestations',
  'cour-des-comptes',
  'minfi-portal',
  // MOU-gated direct APIs — auto-promote MUST NOT flip the selector
  // (it's really an API endpoint shape committed to in the MOU).
  // Architect approval required for any change.
  'minfi-bis',
  'beac-payments',
  'anif-amlscreen',
]);

export function isCritical(sourceId: string): boolean {
  return CRITICAL_ADAPTERS.has(sourceId);
}
