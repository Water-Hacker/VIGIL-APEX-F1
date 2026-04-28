import type { Schemas } from '@vigil/shared';

export interface DossierInput {
  readonly ref: string; // VA-YYYY-NNNN
  readonly language: 'fr' | 'en';
  readonly classification: 'restreint' | 'confidentiel' | 'public';
  readonly finding: Schemas.Finding;
  readonly entities: ReadonlyArray<Schemas.EntityCanonical>;
  readonly signals: ReadonlyArray<Schemas.Signal>;
  readonly counterEvidence: string;
  readonly auditAnchor: { auditEventId: string; polygonTxHash: string | null };
  readonly council: {
    yesVotes: number;
    noVotes: number;
    abstain: number;
    recused: ReadonlyArray<string>;
    proposalIndex: string | null;
  };
  readonly verifyUrl: string; // https://vigilapex.cm/verify/<ref>
  /** Used in the QR code on the cover page. */
  readonly publicLedgerCheckpointUrl: string;
}

export interface DossierRenderResult {
  readonly docxBytes: Buffer;
  readonly contentHash: string; // sha256 of canonical rendered model
}
