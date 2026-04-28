import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the dashboard's a11y suite (Phase C15).
 *
 * Run: `pnpm --filter dashboard exec playwright test`
 *
 * Pages under test in `tests/a11y/*.spec.ts` are exercised against a
 * locally-running Next dev server. CI invokes the full operator + public
 * surfaces; the threshold is "no axe violations of severity ≥ serious".
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.CI
    ? {
        command: 'pnpm next dev -p 3000',
        port: 3000,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
