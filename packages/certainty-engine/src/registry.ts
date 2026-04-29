import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Schemas } from '@vigil/shared';

/**
 * Likelihood-ratio + independence-weight registry loader.
 *
 * The registries are JSON files under `infra/certainty/`. They are git-versioned
 * and hashed; their `version` strings appear in every CertaintyAssessment so
 * a future reviewer can recompute the posterior from the exact input set the
 * engine used at the time of assessment.
 */

const DEFAULT_REGISTRY_DIR = path.resolve(
  process.cwd(),
  'infra',
  'certainty',
);

export interface LoadedRegistries {
  readonly likelihoodRatios: Schemas.LikelihoodRatioRegistry;
  readonly independence: Schemas.IndependenceWeightRegistry;
}

export async function loadRegistries(
  dir: string = process.env.VIGIL_CERTAINTY_REGISTRY_DIR ?? DEFAULT_REGISTRY_DIR,
): Promise<LoadedRegistries> {
  const lrPath = path.join(dir, 'likelihood-ratios.json');
  const indepPath = path.join(dir, 'independence-weights.json');
  const [lrRaw, indepRaw] = await Promise.all([
    readFile(lrPath, 'utf8'),
    readFile(indepPath, 'utf8'),
  ]);
  const likelihoodRatios = Schemas.zLikelihoodRatioRegistry.parse(JSON.parse(lrRaw));
  const independence = Schemas.zIndependenceWeightRegistry.parse(JSON.parse(indepRaw));
  return { likelihoodRatios, independence };
}

export class IndependenceLookup {
  private readonly map: Map<string, number>;
  constructor(private readonly registry: Schemas.IndependenceWeightRegistry) {
    this.map = new Map();
    for (const pair of registry.pairs) {
      this.map.set(IndependenceLookup.key(pair.source_a, pair.source_b), pair.independence);
    }
  }

  static key(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Returns the independence weight in [0,1]. Same source returns 0
   *  (perfectly dependent on itself). Unknown pair returns the registry
   *  default. */
  get(a: string, b: string): number {
    if (a === b) return 0;
    const v = this.map.get(IndependenceLookup.key(a, b));
    if (v !== undefined) return v;
    return this.registry.default_independence;
  }
}

export class LikelihoodRatioLookup {
  private readonly map: Map<string, Schemas.LikelihoodRatio>;
  constructor(private readonly registry: Schemas.LikelihoodRatioRegistry) {
    this.map = new Map();
    for (const ratio of registry.ratios) {
      this.map.set(ratio.pattern_id, ratio);
    }
  }
  get(patternId: string): Schemas.LikelihoodRatio | undefined {
    return this.map.get(patternId);
  }
  prior(): number {
    return this.registry.prior_probability;
  }
}
