import { expect, test } from '@playwright/test';

/**
 * Block-E E.5 / D7 — visual regression for public dashboard surfaces.
 *
 * Captures a deterministic full-page screenshot of each public surface
 * the middleware (Phase C1) lets through without authentication. The
 * baselines live under `public-surfaces.spec.ts-snapshots/` and are
 * regenerated only on architect-supervised stamp passes against the
 * canonical e2e-fixture stack (see playwright-visual.config.ts header
 * for the procedure).
 *
 * Pass criterion (per BLOCK-E-PLAN §2.5): pixel difference ≤ 0.1%
 * (`maxDiffPixelRatio: 0.001`). Higher diff fails CI and surfaces the
 * regression as a workflow-attached HTML diff in
 * `playwright-visual-report/`.
 *
 * Determinism: animations are disabled and the system clock is pinned
 * before the page renders so the same DOM produces the same pixels on
 * any runner. Time-pinning matters because several public pages render
 * "as of" timestamps that would otherwise drift between baseline and
 * verify runs.
 *
 * Coverage today: the 5 unauthenticated surfaces. The remaining 14
 * authenticated dashboard pages (operator + council surfaces) need a
 * mock-JWT fixture and are tracked as a follow-up under D7-extension
 * (PHASE-1-COMPLETION.md). Adding pages here is purely additive — the
 * spec list is the authoritative coverage manifest.
 */
const FROZEN_DATE = new Date('2026-04-01T08:00:00Z').valueOf();

const PUBLIC_PAGES = [
  { path: '/', name: 'home' },
  { path: '/tip', name: 'tip-submit' },
  { path: '/tip/status?ref=TIP-2026-0001', name: 'tip-status' },
  { path: '/verify/VA-2026-0001', name: 'verify' },
  { path: '/ledger', name: 'ledger' },
] as const;

for (const { path, name } of PUBLIC_PAGES) {
  test(`visual: ${name}`, async ({ page }) => {
    // Disable CSS animations + freeze the clock for deterministic pixels.
    await page.addInitScript((frozenMs) => {
      const RealDate = Date;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FrozenDate: any = function (this: unknown, ...args: unknown[]) {
        const inst =
          args.length === 0
            ? new RealDate(frozenMs)
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-spread
              new (RealDate as any)(...args);
        Object.setPrototypeOf(inst, FrozenDate.prototype);
        return inst;
      };
      FrozenDate.prototype = RealDate.prototype;
      FrozenDate.now = () => frozenMs;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Date = FrozenDate;
    }, FROZEN_DATE);
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.001,
      // Mask any element with class "ts-volatile" (timestamps the
      // server stamps with real wall-clock — disabling animations does
      // not help if the value comes from the server). Empty selector
      // by default; pages that need it add the class to the volatile
      // node.
      mask: [page.locator('.ts-volatile')],
    });
  });
}
