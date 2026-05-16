import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

/**
 * Commitment record — what we actually keep on the ledger.
 *
 * We deliberately do NOT store the audit-row payload, the actor, or
 * any identifying context. Fabric is a parallel cryptographic witness
 * over the Postgres hash chain, not a duplicate datastore. A reader
 * who has the Postgres row can independently confirm:
 *   sha256(canonical(row)) === commitment.bodyHash
 * — and a reader who does NOT have the row learns nothing about it
 * beyond seq + timestamp + 32 bytes.
 *
 * Why not store more: multi-org rollout adds CONAC + Cour des Comptes
 * peers, both of whom MUST NOT see operator-only finding text. The
 * commitment-only design lets any peer endorse without needing
 * read access to the application database.
 */
export interface Commitment {
  readonly seq: string; // bigint serialised as string
  readonly bodyHash: string; // 64-char lowercase hex
  readonly recordedAt: string; // RFC3339 from the chaincode txTimestamp
}

const KEY = (seq: string): string => `commit:${seq.padStart(20, '0')}`;
const HEX64 = /^[0-9a-f]{64}$/;
// Tier-18 audit closure: tighten seq regex to 1..19 digits. Postgres
// `bigserial` is a signed 64-bit integer (max 9_223_372_036_854_775_807,
// 19 digits). The previous `{1,20}` permitted callers to submit
// 20-digit values (max 99_999_999_999_999_999_999) that the off-chain
// `audit.actions` row could not represent without overflow — creating
// a witness-without-source-of-truth class of divergence. Reject at the
// chaincode boundary so the worker-fabric-bridge can never persist a
// row whose seq is unrepresentable downstream.
const SEQ_RE = /^[0-9]{1,19}$/;
// Tier-18 audit closure: hard cap on ListCommitments range. The
// off-chain audit-verifier already enforces CROSS_WITNESS_MAX_RANGE =
// 500_000n at the call site (apps/audit-verifier/src/cross-witness.ts);
// we mirror that cap here so a direct chaincode invocation that bypasses
// the verifier (slipstream / interactive `peer chaincode query`) cannot
// build a 50M-element JSON array in the chaincode container heap.
const LIST_COMMITMENTS_MAX_RANGE = 500_000;

@Info({ title: 'AuditWitnessContract', description: 'VIGIL APEX audit-chain witness' })
export class AuditWitnessContract extends Contract {
  /**
   * RecordCommitment — append-only. Re-recording the same seq with the
   * SAME bodyHash is a no-op (idempotent, supports retries from the
   * bridge worker). Re-recording with a DIFFERENT bodyHash throws —
   * that signals a Postgres / Fabric divergence and must be triaged.
   */
  @Transaction()
  async RecordCommitment(ctx: Context, seq: string, bodyHash: string): Promise<void> {
    if (!SEQ_RE.test(seq)) {
      throw new Error(`invalid seq: ${seq}`);
    }
    const lower = bodyHash.toLowerCase();
    if (!HEX64.test(lower)) {
      throw new Error('bodyHash must be 64 lowercase hex chars');
    }

    const key = KEY(seq);
    const existing = await ctx.stub.getState(key);
    if (existing.length > 0) {
      const prior = JSON.parse(existing.toString('utf8')) as Commitment;
      if (prior.bodyHash !== lower) {
        // Hard fail — divergence detected at chaincode level.
        throw new Error(`divergence at seq=${seq}: existing=${prior.bodyHash} new=${lower}`);
      }
      return; // idempotent
    }

    const ts = ctx.stub.getTxTimestamp();
    const recordedAt = new Date(
      ts.seconds.toNumber() * 1000 + Math.floor(ts.nanos / 1_000_000),
    ).toISOString();
    const c: Commitment = { seq, bodyHash: lower, recordedAt };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(c)));
    await ctx.stub.setEvent(
      'CommitmentRecorded',
      Buffer.from(JSON.stringify({ seq, bodyHash: lower, recordedAt })),
    );
  }

  @Transaction(false)
  @Returns('Commitment')
  async GetCommitment(ctx: Context, seq: string): Promise<Commitment | null> {
    if (!SEQ_RE.test(seq)) throw new Error(`invalid seq: ${seq}`);
    const raw = await ctx.stub.getState(KEY(seq));
    if (raw.length === 0) return null;
    return JSON.parse(raw.toString('utf8')) as Commitment;
  }

  /**
   * Sweep — paginated read of [from, to] for the cross-witness
   * verifier. Fabric returns results in lexicographic key order; the
   * KEY() helper zero-pads seq to 20 chars so that order matches
   * numerical seq order.
   *
   * Tier-18 audit closure:
   *   - Range capped at LIST_COMMITMENTS_MAX_RANGE (500k) so a direct
   *     caller can't OOM the chaincode container.
   *   - Iterator closed in a `finally` so a corrupt state row (JSON.parse
   *     throw) does not leak the iterator handle on the way out.
   */
  @Transaction(false)
  @Returns('string')
  async ListCommitments(ctx: Context, from: string, to: string): Promise<string> {
    if (!SEQ_RE.test(from) || !SEQ_RE.test(to)) {
      throw new Error('from/to must be numeric');
    }
    const fromN = BigInt(from);
    const toN = BigInt(to);
    if (toN < fromN) {
      throw new Error(`from/to range invalid: to (${to}) < from (${from})`);
    }
    const span = toN - fromN + 1n;
    if (span > BigInt(LIST_COMMITMENTS_MAX_RANGE)) {
      throw new Error(
        `range ${span} exceeds cap ${LIST_COMMITMENTS_MAX_RANGE}; ` +
          `iterate windows of <=${LIST_COMMITMENTS_MAX_RANGE} seqs`,
      );
    }

    const iter = await ctx.stub.getStateByRange(KEY(from), KEY(to));
    try {
      const out: Commitment[] = [];
      let res = await iter.next();
      while (!res.done) {
        out.push(JSON.parse(res.value.value.toString('utf8')) as Commitment);
        res = await iter.next();
      }
      return JSON.stringify(out);
    } finally {
      await iter.close();
    }
  }
}
