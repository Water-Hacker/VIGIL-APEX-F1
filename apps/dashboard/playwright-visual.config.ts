import { defineConfig, devices } from '@playwright/test';

/**
 * Block-E E.5 / D7 — visual regression harness for the public dashboard
 * surfaces.
 *
 * Run: `pnpm --filter dashboard exec playwright test --config=playwright-visual.config.ts`
 *
 * Baseline generation (one-time, against the canonical e2e-fixture stack
 * — see scripts/e2e-fixture.sh for the seed contract):
 *
 *   pnpm compose:up
 *   pnpm --filter @vigil/db-postgres run migrate
 *   ./scripts/e2e-fixture.sh seed
 *   pnpm --filter dashboard exec playwright test \
 *     --config=playwright-visual.config.ts --update-snapshots
 *
 * Baselines live next to each spec under
 *   tests/visual/public-surfaces.spec.ts-snapshots/
 * and MUST be committed alongside the spec — the CI job hard-fails when
 * a baseline is missing or differs by more than the configured
 * pixel-diff threshold.
 *
 * Threshold (per BLOCK-E-PLAN §2.5): >0.1% pixel difference fails.
 * Implemented via toHaveScreenshot({ maxDiffPixelRatio: 0.001 }) in the
 * spec, paired with this config's expect timeout.
 *
 * Why a separate config (rather than extending playwright.config.ts):
 *  - The a11y suite uses dynamic content (timestamps, fixture rows that
 *    rotate) and has a different pass criterion (axe violations, not
 *    pixel diff). Bundling the two suites under one config would force
 *    every visual baseline to be re-stamped whenever a fixture row
 *    changes, defeating the regression contract.
 *  - The visual suite needs disable-animations + freeze-time hooks that
 *    the a11y suite explicitly does not want.
 */
export default defineConfig({
  testDir: './tests/visual',
  timeout: 60_000,
  // Pixel-diff comparisons take longer than DOM assertions; bump the
  // expect timeout so a slow CI runner does not flake the snapshot
  // attachment phase.
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-visual-report' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    // Deterministic viewport so baselines are stable across machines.
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.CI
    ? {
        command: 'pnpm next dev -p 3000',
        port: 3000,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
