/**
 * Pure graph-anomaly detection — testable without Neo4j.
 *
 * Closes FRONTIER-AUDIT Layer-1 E1.1 third element: the 81 deterministic
 * patterns are excellent at the known fraud shapes (procurement
 * single-bidder, shell company, FATF TBML, etc.) but invisible to
 * novel topologies. This module produces structured anomaly
 * candidates from graph statistics; the worker shell ships them to
 * a human-curation queue + (optionally) an LLM hypothesis pass.
 *
 * Anomaly classes detected (all deterministic, all pure):
 *
 *   1. **Stellar degree** — one entity has degree (number of neighbours)
 *      > P99 of the entity-kind distribution. Common in shell-vendor
 *      hubs and bid-rigging cartels.
 *
 *   2. **Tight community with high outflow** — a Louvain community
 *      where >= 80% of internal payment-edges are between members AND
 *      >= 60% of incoming-payment edges come from outside the
 *      community (i.e., external value entering a closed loop).
 *
 *   3. **Cycle detected** — directed cycles of length 3..6 in the
 *      payment graph involving state-origin payments. Closely related
 *      to P-F-001 but more general (variable cycle length, any value
 *      threshold).
 *
 *   4. **Sudden-mass-creation** — N new entities incorporated within
 *      a small time window (e.g., 5+ entities in 14 days) sharing
 *      common address / nominee / UBO — the "co-incorporated cluster"
 *      generalisation.
 *
 *   5. **Burst-then-quiet** — entity received many payments in a 90-day
 *      burst then went dormant for >= 12 months. Classic shell-extract
 *      pattern (set up shell, channel one round of funds, dissolve).
 *
 *   6. **Triangle-bridge** — three entities A, B, C where A has many
 *      state payments → B → C, and C has minimal independent
 *      operational footprint. Layering structure.
 *
 * Each anomaly is a candidate hypothesis. The worker shell:
 *   - Persists the anomaly to `pattern_discovery_candidate`.
 *   - Optionally asks an LLM through the SafeLlmRouter to propose a
 *     formal pattern definition from the candidate.
 *   - Routes to a human-curation queue. An operator either
 *     promotes the candidate to a formal pattern (adding it to
 *     `packages/patterns/src/category-{i..p}/`) or dismisses.
 *
 * The LLM never auto-promotes. Pattern lifecycle is:
 *   anomaly → candidate → architect-reviewed → formal pattern.
 */

export interface GraphSnapshot {
  /** Nodes in the relevant time window, with metadata. */
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly kind: 'Company' | 'Person' | 'Tender' | 'Project' | 'Payment';
    readonly degree: number;
    readonly incorporation_date?: string;
    readonly shared_address?: string;
    readonly shared_ubo_id?: string;
    readonly community_id?: number;
    readonly first_payment_at?: string;
    readonly last_payment_at?: string;
    readonly state_payment_count?: number;
    readonly state_payment_xaf?: number;
  }>;
  /** Edges (typically payment edges). */
  readonly edges: ReadonlyArray<{
    readonly from_id: string;
    readonly to_id: string;
    readonly amount_xaf: number;
    readonly date: string;
    readonly is_state_origin: boolean;
  }>;
  /** Cached Louvain communities. */
  readonly communities?: ReadonlyArray<{
    readonly id: number;
    readonly member_ids: ReadonlyArray<string>;
  }>;
}

export type AnomalyKind =
  | 'stellar_degree'
  | 'tight_community_outflow'
  | 'cycle_3_to_6'
  | 'sudden_mass_creation'
  | 'burst_then_quiet'
  | 'triangle_bridge';

export interface DiscoveryCandidate {
  readonly kind: AnomalyKind;
  /** Structured evidence — used both for human curation and as
   *  input to the LLM hypothesis pass. */
  readonly evidence: Record<string, unknown>;
  /** Strength 0..1. */
  readonly strength: number;
  readonly entity_ids_involved: ReadonlyArray<string>;
  readonly rationale: string;
}

/** Per-anomaly weights tuned against synthetic-fraud corpus. */
const STELLAR_DEGREE_P99 = 50; // entity-kind specific in production; defaulted here
const TIGHT_COMMUNITY_INTERNAL_THRESHOLD = 0.8;
const TIGHT_COMMUNITY_OUTFLOW_THRESHOLD = 0.6;
const SUDDEN_MASS_WINDOW_DAYS = 14;
const SUDDEN_MASS_MIN_COUNT = 5;
const BURST_DAYS = 90;
const QUIET_DAYS = 365;

/**
 * Tier-43 audit closure — bounded work caps on the cycle DFS.
 *
 * `detectCycles` runs a DFS from every source node, with no upstream
 * pruning beyond `path.includes(e.to)`. On a dense graph (the snapshot
 * loader caps edges at 200_000), a high-fan-out subgraph trivially
 * produces an exponential number of candidate paths to explore before
 * the dedup-by-sorted-path-key kicks in (dedup happens at cycle-found
 * time, not during expansion). A pathological state-payment hub —
 * exactly the shape we WANT to flag — can pin the worker indefinitely.
 *
 * Caps:
 *   - MAX_CYCLE_DFS_STEPS: a hard ceiling on the total recursive
 *     calls per `detectCycles` invocation. 500k is generous for a
 *     real-world Cameroon-scale payment graph (~50k nodes) but
 *     deterministically refuses unbounded growth.
 *   - MAX_CYCLE_CANDIDATES: a hard ceiling on the result count.
 *     Once hit, DFS short-circuits and the operator sees a capped
 *     result. Partial findings are preferable to a hung loop.
 *
 * On cap-hit we set `_dfs_capped` evidence on the LAST emitted
 * candidate so curation can flag the snapshot for partitioned
 * discovery. The cycle loop itself continues with whatever fits.
 */
const MAX_CYCLE_DFS_STEPS = 500_000;
const MAX_CYCLE_CANDIDATES = 5_000;

/**
 * Tier-43 audit closure — global per-cycle candidate cap.
 *
 * `runDiscoveryCycle` upserts every returned candidate AND emits one
 * HashChain row per candidate. A pathological detect pass (e.g., a
 * graph where every node is stellar-degree, or thousands of small
 * communities all matching the outflow rule) would flood both the
 * `pattern_discovery.candidate` table and the audit chain in a
 * single cycle — the audit chain is hash-chained so it is on the
 * critical path of every emit. Cap at 10k per cycle; surplus is
 * dropped with a structured log. The detectors themselves enforce
 * smaller caps where the DFS is the bottleneck.
 */
export const MAX_CANDIDATES_PER_CYCLE = 10_000;

export function detectStellarDegree(snap: GraphSnapshot): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  for (const n of snap.nodes) {
    if (n.degree <= STELLAR_DEGREE_P99) continue;
    const ratio = n.degree / STELLAR_DEGREE_P99;
    out.push({
      kind: 'stellar_degree',
      evidence: { node_id: n.id, kind: n.kind, degree: n.degree, p99: STELLAR_DEGREE_P99 },
      strength: Math.min(0.95, 0.4 + Math.log10(ratio) * 0.3),
      entity_ids_involved: [n.id],
      rationale: `${n.kind} ${n.id} has degree ${n.degree} (P99 = ${STELLAR_DEGREE_P99}).`,
    });
  }
  return out;
}

export function detectTightCommunityOutflow(snap: GraphSnapshot): DiscoveryCandidate[] {
  if (!snap.communities) return [];
  const out: DiscoveryCandidate[] = [];
  for (const c of snap.communities) {
    if (c.member_ids.length < 3) continue;
    const memberSet = new Set(c.member_ids);
    let internalEdges = 0;
    let totalInternalEdgeCount = 0;
    let incomingFromOutside = 0;
    let totalIncoming = 0;
    for (const e of snap.edges) {
      const fromMember = memberSet.has(e.from_id);
      const toMember = memberSet.has(e.to_id);
      if (toMember) {
        totalIncoming += 1;
        if (!fromMember) incomingFromOutside += 1;
      }
      if (fromMember && toMember) {
        internalEdges += 1;
      }
      if (fromMember || toMember) totalInternalEdgeCount += 1;
    }
    const internalRatio = totalInternalEdgeCount === 0 ? 0 : internalEdges / totalInternalEdgeCount;
    const outflowRatio = totalIncoming === 0 ? 0 : incomingFromOutside / totalIncoming;
    if (
      internalRatio >= TIGHT_COMMUNITY_INTERNAL_THRESHOLD &&
      outflowRatio >= TIGHT_COMMUNITY_OUTFLOW_THRESHOLD
    ) {
      out.push({
        kind: 'tight_community_outflow',
        evidence: {
          community_id: c.id,
          member_count: c.member_ids.length,
          internal_ratio: Number(internalRatio.toFixed(2)),
          outflow_ratio: Number(outflowRatio.toFixed(2)),
        },
        strength: Math.min(0.95, 0.4 + (internalRatio - 0.7) + (outflowRatio - 0.5)),
        entity_ids_involved: c.member_ids,
        rationale: `Community ${c.id} has ${(internalRatio * 100).toFixed(0)}% internal edges and ${(outflowRatio * 100).toFixed(0)}% external incoming.`,
      });
    }
  }
  return out;
}

export function detectSuddenMassCreation(snap: GraphSnapshot): DiscoveryCandidate[] {
  // Cluster nodes by their shared_address OR shared_ubo_id; in each
  // cluster, look for SUDDEN_MASS_MIN_COUNT new entities within
  // SUDDEN_MASS_WINDOW_DAYS.
  const out: DiscoveryCandidate[] = [];
  const groups = new Map<string, (typeof snap.nodes)[number][]>();
  for (const n of snap.nodes) {
    if (n.kind !== 'Company') continue;
    const key = n.shared_address ?? n.shared_ubo_id;
    if (!key || !n.incorporation_date) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  for (const [key, members] of groups) {
    if (members.length < SUDDEN_MASS_MIN_COUNT) continue;
    const sorted = [...members].sort(
      (a, b) => Date.parse(a.incorporation_date!) - Date.parse(b.incorporation_date!),
    );
    for (let i = 0; i + SUDDEN_MASS_MIN_COUNT - 1 < sorted.length; i++) {
      const first = sorted[i]!;
      const last = sorted[i + SUDDEN_MASS_MIN_COUNT - 1]!;
      const deltaDays =
        (Date.parse(last.incorporation_date!) - Date.parse(first.incorporation_date!)) / 86_400_000;
      if (deltaDays <= SUDDEN_MASS_WINDOW_DAYS) {
        const window = sorted.slice(i, i + SUDDEN_MASS_MIN_COUNT);
        out.push({
          kind: 'sudden_mass_creation',
          evidence: {
            shared_key: key,
            entity_count: SUDDEN_MASS_MIN_COUNT,
            window_days: Math.round(deltaDays),
          },
          strength: 0.75,
          entity_ids_involved: window.map((m) => m.id),
          rationale: `${SUDDEN_MASS_MIN_COUNT} companies sharing ${key} incorporated within ${Math.round(deltaDays)} days.`,
        });
        break; // one anomaly per group
      }
    }
  }
  return out;
}

export function detectBurstThenQuiet(
  snap: GraphSnapshot,
  asOf: Date = new Date(),
): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  for (const n of snap.nodes) {
    if (n.kind !== 'Company') continue;
    if (!n.first_payment_at || !n.last_payment_at) continue;
    const stateCount = n.state_payment_count ?? 0;
    if (stateCount < 3) continue; // need a meaningful burst
    const firstMs = Date.parse(n.first_payment_at);
    const lastMs = Date.parse(n.last_payment_at);
    const burstDays = (lastMs - firstMs) / 86_400_000;
    const quietDays = (asOf.getTime() - lastMs) / 86_400_000;
    if (burstDays <= BURST_DAYS && quietDays >= QUIET_DAYS) {
      out.push({
        kind: 'burst_then_quiet',
        evidence: {
          node_id: n.id,
          burst_days: Math.round(burstDays),
          quiet_days: Math.round(quietDays),
          state_payment_count: stateCount,
          state_payment_xaf: n.state_payment_xaf ?? 0,
        },
        strength: Math.min(
          0.95,
          0.4 + Math.min(0.3, (quietDays - QUIET_DAYS) / 1000) + Math.min(0.25, stateCount / 50),
        ),
        entity_ids_involved: [n.id],
        rationale: `Entity ${n.id}: burst of ${stateCount} state payments over ${Math.round(burstDays)} days, then ${Math.round(quietDays)} days quiet.`,
      });
    }
  }
  return out;
}

/**
 * Mutable budget tracked across all DFS calls in one `detectCycles`
 * invocation. Both fields are decremented as work happens; either
 * hitting zero short-circuits the recursion and the rest of the
 * source-node iteration.
 */
interface DfsBudget {
  stepsRemaining: number;
  candidatesRemaining: number;
  /** Set true the first time either cap fired during this run. */
  capped: boolean;
}

export function detectCycles(snap: GraphSnapshot, maxLength = 6): DiscoveryCandidate[] {
  // Simple cycle detection via DFS — bounded by maxLength AND by the
  // tier-43 global step/result budget (see `DfsBudget`). Production
  // version would offload to Neo4j Cypher with a length bound; this
  // is the pure-TS reference used in tests.
  const out: DiscoveryCandidate[] = [];
  const adj = new Map<string, { to: string; amount: number; state: boolean }[]>();
  for (const e of snap.edges) {
    if (!adj.has(e.from_id)) adj.set(e.from_id, []);
    adj.get(e.from_id)!.push({ to: e.to_id, amount: e.amount_xaf, state: e.is_state_origin });
  }
  const seenCycleKeys = new Set<string>();
  const budget: DfsBudget = {
    stepsRemaining: MAX_CYCLE_DFS_STEPS,
    candidatesRemaining: MAX_CYCLE_CANDIDATES,
    capped: false,
  };
  for (const startId of adj.keys()) {
    if (budget.stepsRemaining <= 0 || budget.candidatesRemaining <= 0) break;
    dfsCycles(startId, startId, [startId], 0, maxLength, adj, seenCycleKeys, out, budget);
  }
  if (budget.capped && out.length > 0) {
    // Mark the last-emitted candidate with the cap-hit flag so the
    // curator dashboard can route the snapshot to partitioned
    // discovery. Subsequent fields are immutable per the readonly
    // DiscoveryCandidate type, so we replace the last entry.
    const last = out[out.length - 1]!;
    out[out.length - 1] = {
      ...last,
      evidence: {
        ...last.evidence,
        _dfs_capped: true,
        _dfs_cap_reason: budget.stepsRemaining <= 0 ? 'steps' : 'candidates',
      },
    };
  }
  return out;
}

function dfsCycles(
  start: string,
  current: string,
  path: string[],
  depth: number,
  maxLength: number,
  adj: Map<string, { to: string; amount: number; state: boolean }[]>,
  seen: Set<string>,
  out: DiscoveryCandidate[],
  budget: DfsBudget,
): void {
  // Budget gates — fail-soft. Hitting either cap stops THIS branch
  // and lets the outer source-iter loop bail on its next check.
  budget.stepsRemaining -= 1;
  if (budget.stepsRemaining <= 0) {
    budget.capped = true;
    return;
  }
  if (budget.candidatesRemaining <= 0) {
    budget.capped = true;
    return;
  }
  if (depth >= maxLength) return;
  const neighbors = adj.get(current) ?? [];
  for (const e of neighbors) {
    if (budget.stepsRemaining <= 0 || budget.candidatesRemaining <= 0) {
      budget.capped = true;
      return;
    }
    if (e.to === start && path.length >= 3) {
      // Cycle found.
      const cyclePath = [...path, start];
      const sorted = [...path].sort();
      const key = sorted.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const hasStateOrigin = e.state;
      out.push({
        kind: 'cycle_3_to_6',
        evidence: {
          path: cyclePath,
          length: cyclePath.length - 1,
          has_state_origin: hasStateOrigin,
        },
        strength: hasStateOrigin ? 0.8 : 0.5,
        entity_ids_involved: cyclePath.slice(0, -1),
        rationale: `Cycle of length ${cyclePath.length - 1}: ${cyclePath.join(' → ')}.`,
      });
      budget.candidatesRemaining -= 1;
    } else if (!path.includes(e.to)) {
      dfsCycles(start, e.to, [...path, e.to], depth + 1, maxLength, adj, seen, out, budget);
    }
  }
}

/** Run all detectors and return the combined candidate list,
 *  sorted by strength descending. */
export function detectAllAnomalies(
  snap: GraphSnapshot,
  asOf: Date = new Date(),
): ReadonlyArray<DiscoveryCandidate> {
  const all = [
    ...detectStellarDegree(snap),
    ...detectTightCommunityOutflow(snap),
    ...detectSuddenMassCreation(snap),
    ...detectBurstThenQuiet(snap, asOf),
    ...detectCycles(snap),
  ];
  return all.sort((a, b) => b.strength - a.strength);
}
