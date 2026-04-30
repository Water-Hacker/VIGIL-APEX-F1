/**
 * Branded ID types for the VIGIL APEX domain.
 *
 * Per BUILD-V1 §01.2: stable identifiers for every entity. Branded so a
 * `PatternId` cannot accidentally be used where an `EntityId` is expected.
 *
 * Format conventions:
 *   - PatternId  : 'P-A-001' .. 'P-H-003'        (SRD §21)
 *   - SourceId   : 'armp-main', 'rccm-search'    (SRD §10.2 — kebab-case)
 *   - FindingId  : UUIDv7 (time-sortable)
 *   - EntityId   : UUIDv7
 *   - EventId    : UUIDv7
 *   - DocumentCid: IPFS CIDv1 base32
 *   - DossierRef : 'VA-YYYY-NNNN'                (SRD §24.4)
 *   - TipRef     : 'TIP-YYYY-NNNN'               (SRD §28.11)
 *   - ProposalId : on-chain proposal index (uint256 as decimal string)
 */

import { randomUUID } from 'node:crypto';

import type { Brand } from './types.js';

export type PatternId = Brand<string, 'PatternId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type FindingId = Brand<string, 'FindingId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type EventId = Brand<string, 'EventId'>;
export type SignalId = Brand<string, 'SignalId'>;
export type DocumentCid = Brand<string, 'DocumentCid'>;
export type DossierRef = Brand<string, 'DossierRef'>;
export type DossierId = Brand<string, 'DossierId'>;
export type TipRef = Brand<string, 'TipRef'>;
export type TipId = Brand<string, 'TipId'>;
export type ProposalId = Brand<string, 'ProposalId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type CalibrationEntryId = Brand<string, 'CalibrationEntryId'>;
export type ProposalIndex = Brand<string, 'ProposalIndex'>;
export type EthAddress = Brand<string, 'EthAddress'>;
export type Sha256Hex = Brand<string, 'Sha256Hex'>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3,4}-[0-9a-f]{3,4}-[0-9a-f]{12}$/i;
const PATTERN_ID = /^P-[A-H]-\d{3}$/;
const SOURCE_ID = /^[a-z][a-z0-9-]{2,49}$/;
const DOSSIER_REF = /^VA-\d{4}-\d{4,6}$/;
const TIP_REF = /^TIP-\d{4}-\d{4,6}$/;
const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const IPFS_CID_V1 = /^b[a-z2-7]{55,}$/; // base32 CIDv1; trivially permissive guard

/* =============================================================================
 * Factories — generate new IDs
 * ===========================================================================*/

/** UUIDv7 would be nicer for time-sortability; Node 20 stdlib has only v4.
 *  Phase 0 uses v4. Phase 1 swaps to a v7 implementation in db-postgres
 *  (Postgres has a `uuidv7()` extension we'll wire up). */
export const newFindingId = (): FindingId => randomUUID() as FindingId;
export const newEntityId = (): EntityId => randomUUID() as EntityId;
export const newEventId = (): EventId => randomUUID() as EventId;
export const newSignalId = (): SignalId => randomUUID() as SignalId;
export const newTipId = (): TipId => randomUUID() as TipId;
export const newDossierId = (): DossierId => randomUUID() as DossierId;
export const newCalibrationEntryId = (): CalibrationEntryId => randomUUID() as CalibrationEntryId;
export const newAuditEventId = (): AuditEventId => randomUUID() as AuditEventId;
export const newCorrelationId = (): CorrelationId => randomUUID() as CorrelationId;

/* =============================================================================
 * Parsers — runtime validation that strings are valid IDs of their brand
 * ===========================================================================*/

export function asPatternId(s: string): PatternId {
  if (!PATTERN_ID.test(s)) throw new Error(`Invalid PatternId: ${s}`);
  return s as PatternId;
}

export function asSourceId(s: string): SourceId {
  if (!SOURCE_ID.test(s)) throw new Error(`Invalid SourceId: ${s}`);
  return s as SourceId;
}

export function asFindingId(s: string): FindingId {
  if (!UUID_ANY.test(s)) throw new Error(`Invalid FindingId: ${s}`);
  return s as FindingId;
}

export function asEntityId(s: string): EntityId {
  if (!UUID_ANY.test(s)) throw new Error(`Invalid EntityId: ${s}`);
  return s as EntityId;
}

export function asEventId(s: string): EventId {
  if (!UUID_ANY.test(s)) throw new Error(`Invalid EventId: ${s}`);
  return s as EventId;
}

export function asDocumentCid(s: string): DocumentCid {
  if (!IPFS_CID_V1.test(s)) throw new Error(`Invalid DocumentCid (expected CIDv1 base32): ${s}`);
  return s as DocumentCid;
}

export function asDossierRef(s: string): DossierRef {
  if (!DOSSIER_REF.test(s)) throw new Error(`Invalid DossierRef (expected VA-YYYY-NNNN): ${s}`);
  return s as DossierRef;
}

export function asTipRef(s: string): TipRef {
  if (!TIP_REF.test(s)) throw new Error(`Invalid TipRef (expected TIP-YYYY-NNNN): ${s}`);
  return s as TipRef;
}

export function asProposalIndex(s: string): ProposalIndex {
  if (!/^\d+$/.test(s)) throw new Error(`Invalid ProposalIndex: ${s}`);
  return s as ProposalIndex;
}

export function asEthAddress(s: string): EthAddress {
  if (!ETH_ADDRESS.test(s)) throw new Error(`Invalid EthAddress: ${s}`);
  // AUDIT-044: `.toLowerCase()` (no arg) is locale-invariant per the ES
  // spec — only `.toLocaleLowerCase()` could exhibit the Turkish-İ
  // bug-class. The ETH_ADDRESS regex above also rejects any non-ASCII
  // character before this line runs, so even a future regression to
  // `.toLocaleLowerCase()` would not produce 'ı' or 'i̇' here.
  // Pinned by ids.test.ts AUDIT-044 block.
  return s.toLowerCase() as EthAddress;
}

export function asSha256Hex(s: string): Sha256Hex {
  if (!SHA256_HEX.test(s.toLowerCase())) throw new Error(`Invalid sha256 hex: ${s}`);
  // AUDIT-044: same locale-invariance argument as asEthAddress.
  return s.toLowerCase() as Sha256Hex;
}

/* =============================================================================
 * Sequence helpers — for human-readable refs (DossierRef, TipRef)
 * ===========================================================================*/

/**
 * Format a dossier reference from a calendar year and zero-padded sequence.
 * The sequence is allocated by Postgres on insertion; this helper is for tests.
 */
export function formatDossierRef(year: number, seq: number): DossierRef {
  if (year < 2026 || year > 2199) throw new Error(`Invalid year: ${year}`);
  if (seq < 1 || seq > 999_999) throw new Error(`Invalid seq: ${seq}`);
  return `VA-${year}-${String(seq).padStart(4, '0')}` as DossierRef;
}

export function formatTipRef(year: number, seq: number): TipRef {
  if (year < 2026 || year > 2199) throw new Error(`Invalid year: ${year}`);
  if (seq < 1 || seq > 999_999) throw new Error(`Invalid seq: ${seq}`);
  return `TIP-${year}-${String(seq).padStart(4, '0')}` as TipRef;
}

/** Test-only: confirm a UUID string is v4-shaped (catches accidental nonsense). */
export function isUuidV4(s: string): boolean {
  return UUID_V4.test(s);
}
