/**
 * Concern 1 of the post-#69 followup — pin the `workersDisabled[]`
 * subset mechanism's structural shape.
 *
 * The mechanism lets a per-env values file (e.g., values-dev.yaml)
 * declare a list of `worker.name` strings; the chart's
 * worker-{deployment,service,hpa} templates skip those entries while
 * keeping the canonical `workers[]` list intact (so the
 * helm-values-drift worker-parity check stays clean).
 *
 * Test contract:
 *   1. `values.yaml` declares an empty `workersDisabled: []` default.
 *   2. Every name in `values-dev.yaml workersDisabled[]` MUST appear in
 *      `values.yaml workers[]` — otherwise it's typo-bait that would
 *      silently no-op in helm.
 *   3. The three worker templates (deployment, service, hpa) all gate
 *      on the disabled list (regression-pin so a future refactor of
 *      one template doesn't drift from the others).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_DIR = join(__dirname, '..', '..', 'infra', 'k8s', 'charts', 'vigil-apex');

function parseYaml(path: string): unknown {
  const r = spawnSync(
    'python3',
    [
      '-c',
      'import sys, json, yaml; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)',
      path,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`failed to parse ${path} via python3+pyyaml: ${r.stderr.slice(0, 500)}`);
  }
  return JSON.parse(r.stdout) as unknown;
}

interface ValuesWithWorkers {
  readonly workers?: ReadonlyArray<{ name?: string }>;
  readonly workersDisabled?: ReadonlyArray<string>;
}

describe('values.yaml — workersDisabled default', () => {
  it('declares `workersDisabled: []` as the documented default', () => {
    const base = parseYaml(join(CHART_DIR, 'values.yaml')) as ValuesWithWorkers;
    expect(base.workersDisabled).toBeDefined();
    expect(Array.isArray(base.workersDisabled)).toBe(true);
    expect(base.workersDisabled).toEqual([]);
  });
});

describe('values-dev.yaml — workersDisabled[] subset is a real worker subset', () => {
  it('every disabled name resolves to a worker.name in values.yaml workers[]', () => {
    const base = parseYaml(join(CHART_DIR, 'values.yaml')) as ValuesWithWorkers;
    const dev = parseYaml(join(CHART_DIR, 'values-dev.yaml')) as ValuesWithWorkers;
    const workerNames = new Set(
      (base.workers ?? []).map((w) => w.name).filter((n): n is string => typeof n === 'string'),
    );
    const disabled = dev.workersDisabled ?? [];
    expect(disabled.length).toBeGreaterThan(0); // dev DOES disable some by design
    for (const name of disabled) {
      expect(
        workerNames.has(name),
        `dev disables "${name}" but it is not in values.yaml workers[] — typo would silently no-op`,
      ).toBe(true);
    }
  });

  it('values-dev.yaml leaves at least one worker enabled (worker-pattern, by current intent)', () => {
    const base = parseYaml(join(CHART_DIR, 'values.yaml')) as ValuesWithWorkers;
    const dev = parseYaml(join(CHART_DIR, 'values-dev.yaml')) as ValuesWithWorkers;
    const workerNames = (base.workers ?? [])
      .map((w) => w.name)
      .filter((n): n is string => typeof n === 'string');
    const disabledSet = new Set(dev.workersDisabled ?? []);
    const enabled = workerNames.filter((n) => !disabledSet.has(n));
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    expect(enabled).toContain('worker-pattern');
  });
});

describe('worker-{deployment,service,hpa}.yaml — all three honour workersDisabled', () => {
  const TEMPLATES = ['worker-deployment.yaml', 'worker-service.yaml', 'worker-hpa.yaml'] as const;

  it.each(TEMPLATES)('%s gates on workersDisabled (skip-if-in-list)', (name) => {
    const body = readFileSync(join(CHART_DIR, 'templates', name), 'utf8');
    // Each template declares the same `$disabled := .Values.workersDisabled`
    // line + a `has $worker.name $disabled` gate. The double-check pins both.
    expect(body).toContain('.Values.workersDisabled');
    expect(body).toContain('has $worker.name $disabled');
  });
});
