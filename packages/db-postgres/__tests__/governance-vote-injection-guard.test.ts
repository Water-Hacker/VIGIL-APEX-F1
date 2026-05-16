/**
 * Tier-27 audit closure — GovernanceRepo.insertVote SQL-injection guard.
 *
 * Pre-T27 the vote-counter increment used:
 *   const choiceCol = `${row.choice.toLowerCase()}_votes` as const;
 *   sql`UPDATE governance.proposal SET ${sql.raw(choiceCol)} = ${sql.raw(choiceCol)} + 1`
 *
 * `sql.raw` is drizzle's "interpolate literally, never quote" hand-
 * grenade. With the type system bypassed (`as never` cast at a caller,
 * schema drift, or a new vote-choice added without updating the call
 * site) it was a clean SQL-injection surface.
 *
 * Source-grep regression style (precedent: worker-anchor
 * contract-address-guard.test.ts) — the new path uses a static
 * choice→drizzle-column map so `sql.raw` is unreachable; pin via
 * grep so a future PR can't reintroduce the danger without
 * tripping the test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO_ROOT, 'packages/db-postgres/src/repos/governance.ts'), 'utf8');

describe('Tier-27 — insertVote SQL-injection guard', () => {
  it('source has NO `sql.raw(` call (drizzle interpolate-literally hand-grenade removed)', () => {
    // The danger pattern: ${sql.raw(<anything-stringly>)} inside a
    // sql` template. If this regex ever matches in governance.ts, the
    // injection surface is back.
    expect(SRC).not.toMatch(/sql\.raw\s*\(/);
  });

  it('source declares a colByChoice map keyed by lowercase choice strings', () => {
    expect(SRC).toMatch(/colByChoice\s*=\s*\{/);
    expect(SRC).toMatch(/yes:\s*govSchema\.proposal\.yes_votes/);
    expect(SRC).toMatch(/no:\s*govSchema\.proposal\.no_votes/);
    expect(SRC).toMatch(/abstain:\s*govSchema\.proposal\.abstain_votes/);
    expect(SRC).toMatch(/recuse:\s*govSchema\.proposal\.recuse_votes/);
  });

  it('source throws on unknown vote choice (no silent column drop)', () => {
    expect(SRC).toMatch(/throw new Error\([^)]*unknown vote choice/);
  });

  it('insertVote wraps INSERT + UPDATE in a transaction', () => {
    const idx = SRC.indexOf('async insertVote(');
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(idx, idx + 3000);
    expect(window).toMatch(/this\.db\.transaction\(/);
    // Inside the tx body the inserts and updates should use the
    // tx handle, not this.db, so they share the transaction.
    // Prettier may split `await tx.update(...)` across lines; use /s
    // dotall so the regex spans newlines.
    expect(window).toMatch(/tx\.insert\(govSchema\.vote\)/s);
    expect(window).toMatch(/tx\s*\.update\(govSchema\.proposal\)/s);
  });
});
