import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * WCAG AA accessibility scan over the public surfaces. The middleware
 * (Phase C1) lets these pages through without authentication, so the
 * suite can hit them with a vanilla browser. Operator surfaces are
 * exercised in operator-surfaces.spec.ts with a mock JWT cookie.
 *
 * Threshold: zero violations at severity ≥ "serious". Lower-severity
 * findings are reported in the HTML report but don't fail CI — that
 * lets us tighten over time without breaking the build today.
 */
const PUBLIC_PAGES = [
  '/',
  '/tip',
  '/tip/status?ref=TIP-2026-0001',
  '/verify/VA-2026-0001',
  '/ledger',
] as const;

for (const path of PUBLIC_PAGES) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
