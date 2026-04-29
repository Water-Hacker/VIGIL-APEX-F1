import { z } from 'zod';

import { CMR_REGION_CODES, PATTERN_CATEGORIES, PILLARS } from '../constants.js';

/* =============================================================================
 * Primitive shapes — reused everywhere
 * ===========================================================================*/

export const zUuid = z
  .string()
  .uuid({ message: 'Must be a UUID (any version)' });

export const zSha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Must be a 64-hex-char SHA-256 digest')
  .transform((s) => s.toLowerCase());
export type Sha256Hex = z.infer<typeof zSha256Hex>;

export const zEthAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 40-hex Ethereum/Polygon address')
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const zIpfsCid = z
  .string()
  .regex(/^b[a-z2-7]{55,}$/, 'Must be a CIDv1 base32');
export type DocumentCid = z.infer<typeof zIpfsCid>;

export const zPatternId = z
  .string()
  .regex(/^P-[A-H]-\d{3}$/, 'Must be P-<A..H>-NNN');

export const zSourceId = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z][a-z0-9-]+$/, 'Must be lower-case kebab');

export const zIsoInstant = z
  .string()
  .datetime({ offset: true, precision: 3, message: 'Must be ISO-8601 with offset' });

export const zCmrRegion = z.enum(CMR_REGION_CODES as unknown as [string, ...string[]]);

export const zPatternCategoryLetter = z.enum(
  PATTERN_CATEGORIES.map((c) => c.letter) as unknown as [string, ...string[]],
);

export const zPillar = z.enum(PILLARS as unknown as [string, ...string[]]);

export const zSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof zSeverity>;

export const zXafAmount = z
  .number()
  .int()
  .min(-1e15, 'XAF amount out of safe range (negative bound)')
  .max(1e15, 'XAF amount out of safe range (positive bound)');

export const zCorrelationId = zUuid;

export const zUrl = z.string().url();

/* =============================================================================
 * Common envelopes
 * ===========================================================================*/

/** Citation for any LLM extraction — every extracted field carries one. */
export const zCitation = z.object({
  document_cid: zIpfsCid,
  page: z.number().int().nonnegative().nullable(),
  char_span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
});
export type Citation = z.infer<typeof zCitation>;

/** Standard "insufficient evidence" response — SRD §20.3. */
export const zInsufficientEvidence = z.object({
  status: z.literal('insufficient_evidence'),
  reason: z.string().min(1).max(500),
});
export type InsufficientEvidence = z.infer<typeof zInsufficientEvidence>;

/** Pagination envelope. */
export const zPagination = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(500).default(50),
});
export type Pagination = z.infer<typeof zPagination>;
