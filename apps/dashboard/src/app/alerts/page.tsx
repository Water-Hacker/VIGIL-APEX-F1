/**
 * Operator alerts page (Concern B in the R3 build).
 *
 * Surfaces rows from `audit.anomaly_alert`. Initial render is server-
 * rendered for SEO, a11y, and works-with-JS-off — the SSE-driven
 * <AlertsTable/> island is layered on top for live updates.
 *
 * RBAC: gated to operator + auditor + architect via the middleware
 * rule for `/alerts` (ROUTE_RULES in src/middleware.ts).
 *
 * Query string filters:
 *   ?state=open,acknowledged,dismissed,promoted_to_finding
 *   ?sev=critical,high,medium,low,info
 * Default: `state=open` only, all severities. Standard anchor-tag
 * pivots toggle each filter — no client JS needed for the filter
 * controls; SSE only kicks in on the table for live prepend.
 */
import { AlertsTable, type AlertsTableLabels } from '../../components/alerts-table';
import { Card } from '../../components/card';
import {
  ALL_SEVERITIES,
  ALL_STATES,
  countAlerts,
  listAlerts,
  type AlertSeverity,
  type AlertState,
} from '../../lib/alerts.server';
import { getLocale, loadMessages, t } from '../../lib/i18n';

import type { Metadata } from 'next';
import type { JSX } from 'react';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VIGIL APEX · Alertes / Alerts',
  robots: 'noindex, nofollow',
};

function parseList<T extends string>(
  raw: string | string[] | undefined,
  allowed: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  const parts = value.split(',').map((p) => p.trim()) as T[];
  return parts.filter((p) => allowed.includes(p));
}

export default async function AlertsPage({
  searchParams,
}: {
  readonly searchParams: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);

  const stateFilter = parseList<AlertState>(searchParams['state'], ALL_STATES);
  const severityFilter = parseList<AlertSeverity>(searchParams['sev'], ALL_SEVERITIES);
  // Default behaviour: when no explicit ?state= is supplied, show
  // open alerts only — what the operator most often wants. An
  // explicit `?state=all` clears the filter.
  const effectiveStates: ReadonlyArray<AlertState> =
    stateFilter.length > 0
      ? stateFilter
      : searchParams['state'] === 'all'
        ? []
        : (['open'] as const);

  const [alerts, counts] = await Promise.all([
    listAlerts({
      states: effectiveStates.length > 0 ? effectiveStates : undefined,
      severities: severityFilter.length > 0 ? severityFilter : undefined,
      limit: 200,
    }),
    countAlerts(),
  ]);

  const tableLabels: AlertsTableLabels = {
    th_severity: t(messages, 'alerts.th_severity'),
    th_actor: t(messages, 'alerts.th_actor'),
    th_summary: t(messages, 'alerts.th_summary'),
    th_detected: t(messages, 'alerts.th_detected'),
    th_state: t(messages, 'alerts.th_state'),
    th_actions: t(messages, 'alerts.th_actions'),
    btn_acknowledge: t(messages, 'alerts.btn_acknowledge'),
    btn_dismiss: t(messages, 'alerts.btn_dismiss'),
    btn_promote: t(messages, 'alerts.btn_promote'),
    state_open: t(messages, 'alerts.state_open'),
    state_acknowledged: t(messages, 'alerts.state_acknowledged'),
    state_dismissed: t(messages, 'alerts.state_dismissed'),
    state_promoted: t(messages, 'alerts.state_promoted'),
    severity_critical: t(messages, 'alerts.severity_critical'),
    severity_high: t(messages, 'alerts.severity_high'),
    severity_medium: t(messages, 'alerts.severity_medium'),
    severity_low: t(messages, 'alerts.severity_low'),
    severity_info: t(messages, 'alerts.severity_info'),
    empty: t(messages, 'alerts.empty_state'),
    live_label: t(messages, 'alerts.live_label'),
    live_announce_new: t(messages, 'alerts.live_announce_new'),
    transition_failed: t(messages, 'alerts.transition_failed'),
    transition_409: t(messages, 'alerts.transition_409'),
    busy: t(messages, 'alerts.busy'),
  };

  return (
    <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 id="alerts-heading" style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>
          {t(messages, 'alerts.title')}
        </h1>
        <p style={{ margin: 0, color: 'var(--muted, #6b7280)', fontSize: '0.95rem' }}>
          {t(messages, 'alerts.subtitle')}
        </p>
      </header>

      <Card>
        <CountStrip counts={counts} messages={messages} />
        <Filters
          activeStates={effectiveStates}
          activeSeverities={severityFilter}
          allStatesMode={effectiveStates.length === 0}
          messages={messages}
          tableLabels={tableLabels}
        />
        <AlertsTable initial={alerts} locale={locale} labels={tableLabels} />
        <p
          style={{
            marginTop: '0.75rem',
            fontSize: '0.8rem',
            color: 'var(--muted, #6b7280)',
            textAlign: 'center',
          }}
        >
          {t(messages, 'alerts.live_hint')}
        </p>
      </Card>
    </main>
  );
}

function CountStrip({
  counts,
  messages,
}: {
  readonly counts: Awaited<ReturnType<typeof countAlerts>>;
  readonly messages: Record<string, string>;
}): JSX.Element {
  const items: Array<{ label: string; value: number; color: string }> = [
    { label: t(messages, 'alerts.count_open'), value: counts.open, color: '#dc2626' },
    {
      label: t(messages, 'alerts.count_acknowledged'),
      value: counts.acknowledged,
      color: '#0369a1',
    },
    { label: t(messages, 'alerts.count_dismissed'), value: counts.dismissed, color: '#52525b' },
    { label: t(messages, 'alerts.count_promoted'), value: counts.promoted, color: '#15803d' },
  ];
  return (
    <ul
      aria-label={t(messages, 'alerts.counts_label')}
      style={{
        display: 'flex',
        gap: '1rem',
        flexWrap: 'wrap',
        margin: 0,
        padding: 0,
        listStyle: 'none',
        marginBottom: '0.75rem',
      }}
    >
      {items.map((it) => (
        <li
          key={it.label}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #e5e7eb',
            background: 'white',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: '0.5rem',
              height: '0.5rem',
              borderRadius: '999px',
              background: it.color,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>{it.value}</span>
          <span style={{ color: 'var(--muted, #6b7280)', fontSize: '0.875rem' }}>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Filters({
  activeStates,
  activeSeverities,
  allStatesMode,
  messages,
  tableLabels,
}: {
  readonly activeStates: ReadonlyArray<AlertState>;
  readonly activeSeverities: ReadonlyArray<AlertSeverity>;
  readonly allStatesMode: boolean;
  readonly messages: Record<string, string>;
  readonly tableLabels: AlertsTableLabels;
}): JSX.Element {
  return (
    <nav
      aria-label={t(messages, 'alerts.filters_label')}
      style={{
        display: 'flex',
        gap: '1.5rem',
        flexWrap: 'wrap',
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <FilterGroup
        title={t(messages, 'alerts.filter_state')}
        items={[
          {
            href: hrefWithFilters({ state: undefined, sev: activeSeverities }),
            label: tableLabels.state_open + ' (default)',
            active: activeStates.length === 1 && activeStates[0] === 'open' && !allStatesMode,
          },
          {
            href: hrefWithFilters({ state: 'acknowledged', sev: activeSeverities }),
            label: tableLabels.state_acknowledged,
            active: activeStates.length === 1 && activeStates[0] === 'acknowledged',
          },
          {
            href: hrefWithFilters({ state: 'dismissed', sev: activeSeverities }),
            label: tableLabels.state_dismissed,
            active: activeStates.length === 1 && activeStates[0] === 'dismissed',
          },
          {
            href: hrefWithFilters({ state: 'promoted_to_finding', sev: activeSeverities }),
            label: tableLabels.state_promoted,
            active: activeStates.length === 1 && activeStates[0] === 'promoted_to_finding',
          },
          {
            href: hrefWithFilters({ state: 'all', sev: activeSeverities }),
            label: t(messages, 'alerts.filter_state_all'),
            active: allStatesMode,
          },
        ]}
      />
      <FilterGroup
        title={t(messages, 'alerts.filter_severity')}
        items={[
          {
            href: hrefWithFilters({
              state: pickStateForLink(activeStates, allStatesMode),
              sev: [],
            }),
            label: t(messages, 'alerts.filter_severity_all'),
            active: activeSeverities.length === 0,
          },
          ...ALL_SEVERITIES.map((s) => ({
            href: hrefWithFilters({
              state: pickStateForLink(activeStates, allStatesMode),
              sev: [s],
            }),
            label: tableLabels[`severity_${s}` as keyof AlertsTableLabels],
            active: activeSeverities.length === 1 && activeSeverities[0] === s,
          })),
        ]}
      />
    </nav>
  );
}

function FilterGroup({
  title,
  items,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<{ href: string; label: string; active: boolean }>;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--muted, #6b7280)' }}>{title}:</span>
      {items.map((it) => (
        <a
          key={it.label}
          href={it.href}
          aria-current={it.active ? 'page' : undefined}
          style={{
            padding: '0.25rem 0.625rem',
            fontSize: '0.8125rem',
            borderRadius: '0.375rem',
            border: '1px solid #d1d5db',
            background: it.active ? '#1f2937' : 'white',
            color: it.active ? 'white' : '#374151',
            textDecoration: 'none',
          }}
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}

function pickStateForLink(
  activeStates: ReadonlyArray<AlertState>,
  allStatesMode: boolean,
): AlertState | 'all' | undefined {
  if (allStatesMode) return 'all';
  if (activeStates.length === 1) return activeStates[0];
  return undefined;
}

function hrefWithFilters(opts: {
  readonly state: AlertState | 'all' | undefined;
  readonly sev: ReadonlyArray<AlertSeverity>;
}): string {
  const qs = new URLSearchParams();
  if (opts.state !== undefined) qs.set('state', opts.state);
  if (opts.sev.length > 0) qs.set('sev', opts.sev.join(','));
  const s = qs.toString();
  return s ? `/alerts?${s}` : '/alerts';
}
