/**
 * Regional choropleth page — operator surface.
 *
 * RBAC: gated to operator + auditor + architect via the middleware
 * rule for `/regions`. The page is server-rendered (no client JS
 * required to display the map); drill-down via standard anchor
 * tags to `/findings?region=X`. Bilingual FR/EN per the operator's
 * locale cookie or Accept-Language header.
 *
 * Query string `?window=N` selects the time window in days
 * (clamped to {30, 90, 180, 365}; default 90). The page is
 * statically-data-fresh-up-to-60s via `revalidate = 60`.
 */
import { Card } from '../../components/card';
import { RegionHeatmap } from '../../components/region-heatmap';
import { getLocale, loadMessages, t } from '../../lib/i18n';
import { aggregateByRegion } from '../../lib/regions.server';

import type { Metadata } from 'next';
import type { JSX } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'VIGIL APEX · Carte régionale / Regional map',
  robots: 'noindex, nofollow',
};

const ALLOWED_WINDOWS = [30, 90, 180, 365] as const;
type WindowDays = (typeof ALLOWED_WINDOWS)[number];

function parseWindow(searchParams: Record<string, string | string[] | undefined>): WindowDays {
  const raw = searchParams['window'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  if (ALLOWED_WINDOWS.includes(n as WindowDays)) return n as WindowDays;
  return 90;
}

export default async function RegionsPage({
  searchParams,
}: {
  readonly searchParams: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const windowDays = parseWindow(searchParams);
  const aggregate = await aggregateByRegion({ windowDays });

  return (
    <main style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 id="regions-heading" style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>
          {t(messages, 'regions.title')}
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #6b7280)', fontSize: '0.95rem' }}>
          {t(messages, 'regions.subtitle')}
        </p>
      </header>

      <Card>
        <WindowSwitcher current={windowDays} messages={messages} />
        {aggregate.total === 0 ? (
          <p
            role="status"
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--muted, #6b7280)',
              background: '#f9fafb',
              borderRadius: '0.5rem',
            }}
          >
            {t(messages, 'regions.empty_state')}
          </p>
        ) : (
          <RegionHeatmap aggregate={aggregate} locale={locale} captionId="regions-heading" />
        )}
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.8rem',
            color: 'var(--muted, #6b7280)',
            textAlign: 'center',
          }}
        >
          {t(messages, 'regions.click_hint')}
        </p>
      </Card>
    </main>
  );
}

function WindowSwitcher({
  current,
  messages,
}: {
  readonly current: WindowDays;
  readonly messages: Record<string, string>;
}): JSX.Element {
  const labelFor: Record<WindowDays, string> = {
    30: t(messages, 'regions.window_30d'),
    90: t(messages, 'regions.window_90d'),
    180: t(messages, 'regions.window_180d'),
    365: t(messages, 'regions.window_365d'),
  };
  return (
    <nav
      aria-label={t(messages, 'regions.window_label')}
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}
    >
      <span style={{ fontSize: '0.875rem', color: 'var(--muted, #6b7280)', alignSelf: 'center' }}>
        {t(messages, 'regions.window_label')}:
      </span>
      {ALLOWED_WINDOWS.map((w) => {
        const active = w === current;
        return (
          <a
            key={w}
            href={`/regions?window=${w}`}
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '0.25rem 0.75rem',
              fontSize: '0.875rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              background: active ? '#1f2937' : 'white',
              color: active ? 'white' : '#374151',
              textDecoration: 'none',
            }}
          >
            {labelFor[w]}
          </a>
        );
      })}
    </nav>
  );
}
