/**
 * Tier-4 audit — values-cluster.yaml structural invariants.
 *
 * The HA-cluster overrides at infra/k8s/charts/vigil-apex/values-cluster.yaml
 * are the single file that flips every service from dev-mode to its
 * production-grade HA / GPU configuration. A silent regression — e.g.
 * dropping replicaCount: 3 on Vault, or losing the GPU nodeSelector on
 * the workerLocalLlm block — would degrade the cluster without
 * surfacing a CI failure (the helm-golden-drift gate only catches
 * RENDERED-output drift, not structural intent).
 *
 * These tests pin the shape:
 *   1. HA services have replicaCount: 3 (etcd, vault, fabricOrderer,
 *      postgres, redis, ipfs, keycloak, dashboard, caddy,
 *      observability.alertmanager).
 *   2. Single-node services declare a pinnedNode (neo4j, fabricPeer,
 *      tor, observability.prometheus).
 *   3. Every GPU section has nodeSelector.nvidia.com/gpu.present='true'.
 *   4. Every GPU section starts `enabled: false` (DECISION-011 gate).
 *   5. The pinnedNode values cover {a, b, c} (no node forgotten).
 *
 * Catches refactor regressions before they reach the live cluster.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALUES_PATH = join(
  __dirname,
  '..',
  '..',
  'infra',
  'k8s',
  'charts',
  'vigil-apex',
  'values-cluster.yaml',
);

/**
 * Load the values-cluster.yaml as JSON via a python3 subprocess. The
 * `yaml` npm package isn't in the repo root's devDependencies and
 * adding it just for this test would noisy-up the lockfile; pyyaml is
 * already in CI (worker-satellite + worker-image-forensics depend on
 * it) and ships in the python3 base on every Vigil dev host. The
 * shell-out keeps the test pure (no new top-level dep) while still
 * letting us assert structurally on the parsed object.
 */
function parseValuesYaml(): unknown {
  const r = spawnSync(
    'python3',
    [
      '-c',
      'import sys, json, yaml; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)',
      VALUES_PATH,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`failed to parse ${VALUES_PATH} via python3+pyyaml: ${r.stderr.slice(0, 500)}`);
  }
  return JSON.parse(r.stdout) as unknown;
}

interface ResourceBlock {
  readonly nvidia?: { 'com/gpu': number };
  readonly 'nvidia.com/gpu'?: number;
}

interface GpuSection {
  readonly enabled: boolean;
  readonly resources?: { readonly requests?: ResourceBlock; readonly limits?: ResourceBlock };
  readonly nodeSelector?: Record<string, string>;
}

interface ValuesCluster {
  readonly global?: { readonly clusterMode?: string };
  readonly etcd?: { readonly enabled?: boolean; readonly replicaCount?: number };
  readonly vault?: { readonly ha?: { readonly enabled?: boolean; readonly replicaCount?: number } };
  readonly fabricOrderer?: { readonly enabled?: boolean; readonly replicaCount?: number };
  readonly postgres?: {
    readonly ha?: { readonly enabled?: boolean; readonly replicaCount?: number };
  };
  readonly redis?: { readonly ha?: { readonly enabled?: boolean; readonly replicaCount?: number } };
  readonly neo4j?: { readonly enabled?: boolean; readonly pinnedNode?: string };
  readonly ipfs?: { readonly enabled?: boolean; readonly replicaCount?: number };
  readonly fabricPeer?: { readonly enabled?: boolean; readonly pinnedNode?: string };
  readonly dashboard?: { readonly replicas?: number };
  readonly caddy?: { readonly replicas?: number };
  readonly keycloak?: { readonly enabled?: boolean; readonly replicaCount?: number };
  readonly tor?: { readonly enabled?: boolean; readonly pinnedNode?: string };
  readonly observability?: {
    readonly prometheus?: { readonly enabled?: boolean; readonly pinnedNode?: string };
    readonly alertmanager?: { readonly enabled?: boolean; readonly replicaCount?: number };
    readonly grafana?: { readonly enabled?: boolean; readonly replicaCount?: number };
  };
  readonly workerLocalLlm?: GpuSection;
  readonly workerZkProve?: GpuSection;
  readonly workerSatelliteCuda?: GpuSection;
  readonly workerImageForensicsCuda?: GpuSection;
}

function loadValues(): ValuesCluster {
  return parseValuesYaml() as ValuesCluster;
}

describe('values-cluster.yaml — HA replicaCount invariants', () => {
  it('etcd is 3-replica (Patroni DCS quorum)', () => {
    const v = loadValues();
    expect(v.etcd?.enabled).toBe(true);
    expect(v.etcd?.replicaCount).toBe(3);
  });

  it('vault is 3-replica Raft HA', () => {
    const v = loadValues();
    expect(v.vault?.ha?.enabled).toBe(true);
    expect(v.vault?.ha?.replicaCount).toBe(3);
  });

  it('fabricOrderer is 3-replica Raft consenters', () => {
    const v = loadValues();
    expect(v.fabricOrderer?.enabled).toBe(true);
    expect(v.fabricOrderer?.replicaCount).toBe(3);
  });

  it('postgres is 3-replica Patroni HA', () => {
    const v = loadValues();
    expect(v.postgres?.ha?.enabled).toBe(true);
    expect(v.postgres?.ha?.replicaCount).toBe(3);
  });

  it('redis is 3-replica Sentinel HA', () => {
    const v = loadValues();
    expect(v.redis?.ha?.enabled).toBe(true);
    expect(v.redis?.ha?.replicaCount).toBe(3);
  });

  it('ipfs is 3-replica Cluster', () => {
    const v = loadValues();
    expect(v.ipfs?.enabled).toBe(true);
    expect(v.ipfs?.replicaCount).toBe(3);
  });

  it('keycloak is 3-replica', () => {
    const v = loadValues();
    expect(v.keycloak?.enabled).toBe(true);
    expect(v.keycloak?.replicaCount).toBe(3);
  });

  it('dashboard + caddy each have 3 replicas (one per node, edge HA)', () => {
    const v = loadValues();
    expect(v.dashboard?.replicas).toBe(3);
    expect(v.caddy?.replicas).toBe(3);
  });

  it('alertmanager is 3-replica (gossip cluster)', () => {
    const v = loadValues();
    expect(v.observability?.alertmanager?.enabled).toBe(true);
    expect(v.observability?.alertmanager?.replicaCount).toBe(3);
  });
});

describe('values-cluster.yaml — single-node service placement', () => {
  it('neo4j is pinned to a specific node (single-instance + scheduled backup)', () => {
    const v = loadValues();
    expect(v.neo4j?.enabled).toBe(true);
    expect(v.neo4j?.pinnedNode).toMatch(/^[abc]$/);
  });

  it('fabricPeer is pinned to a node (single-peer Phase 1)', () => {
    const v = loadValues();
    expect(v.fabricPeer?.enabled).toBe(true);
    expect(v.fabricPeer?.pinnedNode).toMatch(/^[abc]$/);
  });

  it('tor is pinned to a node (hidden-service keys do not migrate)', () => {
    const v = loadValues();
    expect(v.tor?.enabled).toBe(true);
    expect(v.tor?.pinnedNode).toMatch(/^[abc]$/);
  });

  it('prometheus is pinned to a node (single retention store)', () => {
    const v = loadValues();
    expect(v.observability?.prometheus?.enabled).toBe(true);
    expect(v.observability?.prometheus?.pinnedNode).toMatch(/^[abc]$/);
  });

  it('pinnedNode assignments together cover all three nodes (no orphan node)', () => {
    const v = loadValues();
    const pinned = [
      v.neo4j?.pinnedNode,
      v.fabricPeer?.pinnedNode,
      v.tor?.pinnedNode,
      v.observability?.prometheus?.pinnedNode,
    ].filter((p): p is string => typeof p === 'string');
    const distinct = new Set(pinned);
    // Don't assert the EXACT mapping (allowed to change), but assert
    // that the union of pinned-node assignments touches all 3 nodes —
    // a refactor that accidentally moved both neo4j and prometheus to
    // node 'b' (leaving 'a' bare of single-instance services) would
    // fail this.
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });
});

describe('values-cluster.yaml — GPU section gates', () => {
  const gpuSections = [
    'workerLocalLlm',
    'workerZkProve',
    'workerSatelliteCuda',
    'workerImageForensicsCuda',
  ] as const;

  for (const name of gpuSections) {
    it(`${name} is enabled: false (DECISION-011 gate)`, () => {
      const v = loadValues();
      const section = (v as unknown as Record<string, GpuSection | undefined>)[name];
      expect(section, `${name} missing from values-cluster.yaml`).toBeDefined();
      // The DECISION-011 (AI-SAFETY-DOCTRINE) review gate. A refactor
      // that accidentally flipped this to true would deploy local LLM
      // inference without the doctrine sign-off.
      expect(section!.enabled).toBe(false);
    });

    it(`${name} has nodeSelector nvidia.com/gpu.present='true'`, () => {
      const v = loadValues();
      const section = (v as unknown as Record<string, GpuSection | undefined>)[name];
      expect(section, `${name} missing from values-cluster.yaml`).toBeDefined();
      expect(section!.nodeSelector?.['nvidia.com/gpu.present']).toBe('true');
    });
  }
});

describe('values-cluster.yaml — global cluster identity', () => {
  it('global.clusterMode is "ha-3-node" (chart templates branch on this)', () => {
    const v = loadValues();
    expect(v.global?.clusterMode).toBe('ha-3-node');
  });
});
