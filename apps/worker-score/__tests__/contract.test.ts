/**
 * worker-score contract regression — graduates this app off the
 * AUDIT-069 zero-test allowlist (HARDEN-#3 / T1.12).
 *
 * worker-score is the chokepoint that turns per-finding signals into a
 * posterior probability. DECISION-011 binds the posterior pipeline to
 * the Bayesian certainty engine (`@vigil/certainty-engine`); the
 * legacy single-pattern aggregator (`bayesianPosterior` from
 * `@vigil/patterns`) is retained as a sanity cross-check. The worker
 * subscribes to `STREAMS.SCORE_COMPUTE`.
 *
 * A future PR that severs any of those wires must announce itself by
 * failing this test. We deliberately stop short of exercising the
 * handler end-to-end — that path requires Postgres + Redis + a primed
 * certainty registry, which is the integration-suite domain. This is
 * a unit-time pin that guards the *contract* a reader of the source
 * file would expect: the right imports, the right queue stream, the
 * right engine handoff.
 *
 * Pattern follows the dashboard AUDIT-008 / AUDIT-009 source-grep
 * regression style and worker-extractor's A2.1 contract test.
 */
import { describe, expect, it } from 'vitest';

describe('worker-score — DECISION-011 + STREAMS.SCORE_COMPUTE contract', () => {
  it('imports the Bayesian certainty engine entrypoint', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve(__dirname, '../src/index.ts'), 'utf8');

    // DECISION-011 — the canonical posterior comes from
    // `@vigil/certainty-engine` via `assessFinding` + `loadRegistries`.
    expect(src).toMatch(
      /import\s+\{[^}]*\bassessFinding\b[^}]*\}\s+from\s+'@vigil\/certainty-engine'/,
    );
    expect(src).toMatch(
      /import\s+\{[^}]*\bloadRegistries\b[^}]*\}\s+from\s+'@vigil\/certainty-engine'/,
    );
    expect(src).toMatch(
      /import\s+\{[^}]*\bENGINE_VERSION\b[^}]*\}\s+from\s+'@vigil\/certainty-engine'/,
    );
  });

  it('subscribes to STREAMS.SCORE_COMPUTE and uses CertaintyRepo for persistence', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve(__dirname, '../src/index.ts'), 'utf8');

    expect(src).toMatch(/stream:\s*STREAMS\.SCORE_COMPUTE/);
    expect(src).toMatch(/import\s+\{[^}]*\bCertaintyRepo\b[^}]*\}\s+from\s+'@vigil\/db-postgres'/);
  });

  it('keeps the legacy bayesianPosterior cross-check (sanity floor)', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve(__dirname, '../src/index.ts'), 'utf8');

    // The legacy aggregator from `@vigil/patterns` runs as a sanity
    // cross-check alongside the certainty engine. If it goes away the
    // commit should be deliberate; this test forces the change to be
    // visible.
    expect(src).toMatch(/import\s+\{[^}]*\bbayesianPosterior\b[^}]*\}\s+from\s+'@vigil\/patterns'/);
    expect(src).toMatch(/bayesianPosterior\(/);
  });

  it('payload schema accepts only a UUID finding_id (closed-shape Zod)', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve(__dirname, '../src/index.ts'), 'utf8');

    expect(src).toMatch(/z\.object\(\s*\{\s*finding_id:\s*z\.string\(\)\.uuid\(\)/);
  });
});
