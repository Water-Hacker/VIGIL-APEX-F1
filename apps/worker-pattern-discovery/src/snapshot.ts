import type { GraphSnapshot } from './graph-anomalies.js';
import type { Neo4jClient } from '@vigil/db-neo4j';

/**
 * Load a `GraphSnapshot` from Neo4j covering the last `windowDays`.
 *
 * The snapshot is intentionally bounded: we fetch only nodes that have
 * either been first-seen in the window OR received a state-origin
 * payment in the window. Older entities still appear via edges that
 * touch in-window nodes but they do not anchor anomaly detection on
 * their own (those nodes are reported as "out-of-window-but-touched").
 *
 * Three reads:
 *   1. Companies/Persons/Tenders/Projects/Payments touched in window,
 *      with degree + last/first-payment dates + state payment totals.
 *   2. Payment edges in window, with state-origin flag.
 *   3. Louvain communities (precomputed by worker-graph-metrics, lives
 *      on the Entity node as `community_id` property).
 *
 * All reads are bounded by `maxNodes` / `maxEdges` so a graph-snapshot
 * pull cannot blow up memory on a busy instance. Callers downstream
 * (detectors) operate on whatever fits in the cap; over-cap signals a
 * graph that needs partitioned discovery (out of scope for v1).
 */
export interface LoadSnapshotOptions {
  readonly windowDays?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

interface RawNodeRow {
  readonly id: string;
  readonly kind: string;
  readonly degree: number;
  readonly incorporation_date: string | null;
  readonly shared_address: string | null;
  readonly shared_ubo_id: string | null;
  readonly community_id: number | null;
  readonly first_payment_at: string | null;
  readonly last_payment_at: string | null;
  readonly state_payment_count: number | null;
  readonly state_payment_xaf: number | null;
}

interface RawEdgeRow {
  readonly from_id: string;
  readonly to_id: string;
  readonly amount_xaf: number;
  readonly date: string;
  readonly is_state_origin: boolean;
}

export async function loadGraphSnapshot(
  neo4j: Neo4jClient,
  opts: LoadSnapshotOptions = {},
): Promise<GraphSnapshot> {
  const windowDays = opts.windowDays ?? 90;
  const maxNodes = opts.maxNodes ?? 50_000;
  const maxEdges = opts.maxEdges ?? 200_000;

  const nodeQuery = `
    MATCH (n)
    WHERE labels(n)[0] IN ['Company','Person','Tender','Project','Payment']
      AND (
        coalesce(n.first_seen, n.incorporation_date, n.created_at) >= datetime() - duration({days: $windowDays})
        OR EXISTS {
          MATCH (n)-[r:PAYS|RECEIVES_FROM]-(other)
          WHERE r.date >= datetime() - duration({days: $windowDays})
        }
      )
    OPTIONAL MATCH (n)-[rDeg]-()
    WITH n, count(DISTINCT rDeg) AS degree
    OPTIONAL MATCH (n)-[pIn:RECEIVES_FROM]->(stateSrc)
      WHERE coalesce(stateSrc.is_state_origin, false) = true
        AND pIn.date >= datetime() - duration({days: $windowDays})
    WITH
      n,
      degree,
      collect(pIn) AS statePayments
    RETURN
      n.id                                                   AS id,
      labels(n)[0]                                           AS kind,
      degree                                                 AS degree,
      toString(n.incorporation_date)                         AS incorporation_date,
      n.shared_address                                       AS shared_address,
      n.shared_ubo_id                                        AS shared_ubo_id,
      n.community_id                                         AS community_id,
      toString(reduce(min = null, p IN statePayments | CASE WHEN min IS NULL OR p.date < min THEN p.date ELSE min END))
                                                             AS first_payment_at,
      toString(reduce(max = null, p IN statePayments | CASE WHEN max IS NULL OR p.date > max THEN p.date ELSE max END))
                                                             AS last_payment_at,
      size(statePayments)                                    AS state_payment_count,
      reduce(total = 0, p IN statePayments | total + coalesce(p.amount_xaf, 0))
                                                             AS state_payment_xaf
    LIMIT $maxNodes
  `;

  const edgeQuery = `
    MATCH (from)-[r:PAYS|RECEIVES_FROM]->(to)
    WHERE r.date >= datetime() - duration({days: $windowDays})
    RETURN
      from.id                                AS from_id,
      to.id                                  AS to_id,
      coalesce(r.amount_xaf, 0)              AS amount_xaf,
      toString(r.date)                       AS date,
      coalesce(r.is_state_origin, false)     AS is_state_origin
    LIMIT $maxEdges
  `;

  const communityQuery = `
    MATCH (n)
    WHERE n.community_id IS NOT NULL
    WITH n.community_id AS id, collect(n.id) AS member_ids
    RETURN id, member_ids
    LIMIT 5000
  `;

  const [rawNodes, rawEdges, rawCommunities] = await Promise.all([
    neo4j.run<RawNodeRow>(nodeQuery, { windowDays, maxNodes }),
    neo4j.run<RawEdgeRow>(edgeQuery, { windowDays, maxEdges }),
    neo4j
      .run<{ id: number; member_ids: ReadonlyArray<string> }>(communityQuery)
      .catch(() => [] as ReadonlyArray<{ id: number; member_ids: ReadonlyArray<string> }>),
  ]);

  const knownKinds: ReadonlyArray<'Company' | 'Person' | 'Tender' | 'Project' | 'Payment'> = [
    'Company',
    'Person',
    'Tender',
    'Project',
    'Payment',
  ];

  const nodes = rawNodes
    .filter((n): n is RawNodeRow & { kind: (typeof knownKinds)[number] } =>
      (knownKinds as ReadonlyArray<string>).includes(n.kind),
    )
    .map((n) => {
      const base = {
        id: n.id,
        kind: n.kind,
        degree: typeof n.degree === 'number' ? n.degree : 0,
      };
      return {
        ...base,
        ...(n.incorporation_date ? { incorporation_date: n.incorporation_date } : {}),
        ...(n.shared_address ? { shared_address: n.shared_address } : {}),
        ...(n.shared_ubo_id ? { shared_ubo_id: n.shared_ubo_id } : {}),
        ...(typeof n.community_id === 'number' ? { community_id: n.community_id } : {}),
        ...(n.first_payment_at ? { first_payment_at: n.first_payment_at } : {}),
        ...(n.last_payment_at ? { last_payment_at: n.last_payment_at } : {}),
        ...(typeof n.state_payment_count === 'number'
          ? { state_payment_count: n.state_payment_count }
          : {}),
        ...(typeof n.state_payment_xaf === 'number'
          ? { state_payment_xaf: n.state_payment_xaf }
          : {}),
      };
    });

  const edges = rawEdges.map((e) => ({
    from_id: e.from_id,
    to_id: e.to_id,
    amount_xaf: typeof e.amount_xaf === 'number' ? e.amount_xaf : Number(e.amount_xaf ?? 0),
    date: e.date,
    is_state_origin: Boolean(e.is_state_origin),
  }));

  const communities =
    rawCommunities.length > 0
      ? rawCommunities.map((c) => ({
          id: typeof c.id === 'number' ? c.id : Number(c.id),
          member_ids: c.member_ids,
        }))
      : undefined;

  return {
    nodes,
    edges,
    ...(communities ? { communities } : {}),
  };
}
