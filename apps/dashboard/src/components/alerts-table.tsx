'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AlertRow, AlertState } from '../lib/alerts.server';

/**
 * Operator-facing live alerts table.
 *
 * Two responsibilities, intentionally co-located in one component:
 *
 *   1. Render the initial server-rendered table the page handed us.
 *   2. Open an EventSource to `/api/alerts/stream`; PREPEND every
 *      incoming `alert` event AND announce it through an
 *      `aria-live="polite"` region so screen-reader users hear the
 *      arrival.
 *
 * State transitions (acknowledge / dismiss / promote) are POSTed to
 * `/api/alerts/[id]/acknowledge`. The route writes a TAL-PA
 * `status.changed` row to the audit chain BEFORE mutating the alert,
 * so there is no "dark period" between the operator action and the
 * audit trail.
 *
 * The component is deliberately framework-light: no react-query, no
 * Zustand, no shadcn — just useState + useEffect + the standard
 * fetch API + EventSource. The /alerts surface needs to stay
 * legible in a code review by a security auditor who is not a
 * React expert.
 */

export interface AlertsTableLabels {
  readonly th_severity: string;
  readonly th_actor: string;
  readonly th_summary: string;
  readonly th_detected: string;
  readonly th_state: string;
  readonly th_actions: string;
  readonly btn_acknowledge: string;
  readonly btn_dismiss: string;
  readonly btn_promote: string;
  readonly state_open: string;
  readonly state_acknowledged: string;
  readonly state_dismissed: string;
  readonly state_promoted: string;
  readonly severity_critical: string;
  readonly severity_high: string;
  readonly severity_medium: string;
  readonly severity_low: string;
  readonly severity_info: string;
  readonly empty: string;
  readonly live_label: string;
  readonly live_announce_new: string;
  readonly transition_failed: string;
  readonly transition_409: string;
  readonly busy: string;
}

interface AlertsTableProps {
  readonly initial: ReadonlyArray<AlertRow>;
  readonly locale: 'fr' | 'en';
  readonly labels: AlertsTableLabels;
}

const SEVERITY_BG: Readonly<Record<string, string>> = {
  critical: '#7f1d1d',
  high: '#b91c1c',
  medium: '#c2410c',
  low: '#a16207',
  info: '#1e40af',
};

const STATE_BG: Readonly<Record<AlertState, string>> = {
  open: '#dc2626',
  acknowledged: '#0369a1',
  dismissed: '#52525b',
  promoted_to_finding: '#15803d',
};

export function AlertsTable({ initial, locale, labels }: AlertsTableProps): JSX.Element {
  const [rows, setRows] = useState<AlertRow[]>(() => [...initial]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [liveMessage, setLiveMessage] = useState<string>('');
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // EventSource lifecycle — open once on mount, close on unmount.
  useEffect(() => {
    const url = '/api/alerts/stream';
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener('alert', (evt) => {
      const data = JSON.parse((evt as MessageEvent).data) as AlertRow;
      setRows((prev) => {
        // Dedupe by id — a reconnect could replay rows we already have.
        if (prev.some((r) => r.id === data.id)) return prev;
        return [data, ...prev].slice(0, 200);
      });
      const summary = locale === 'fr' ? data.summary_fr : data.summary_en;
      setLiveMessage(
        labels.live_announce_new
          .replace('{severity}', readableSeverity(data.severity, labels))
          .replace('{summary}', summary),
      );
      if (liveTimer.current) clearTimeout(liveTimer.current);
      // Clear the live message after 6 s so consecutive identical
      // alerts re-announce correctly (some screen readers ignore
      // unchanged live-region content).
      liveTimer.current = setTimeout(() => setLiveMessage(''), 6_000);
    });

    return () => {
      es.close();
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [labels.live_announce_new, locale, labels]);

  const transition = useCallback(
    async (id: string, target: AlertState) => {
      setBusy((prev) => new Set(prev).add(id));
      setErrorById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        const r = await fetch(`/api/alerts/${id}/acknowledge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: target }),
        });
        if (r.status === 409) {
          setErrorById((prev) => ({ ...prev, [id]: labels.transition_409 }));
          return;
        }
        if (!r.ok) {
          setErrorById((prev) => ({ ...prev, [id]: labels.transition_failed }));
          return;
        }
        const payload = (await r.json()) as { alert: AlertRow };
        setRows((prev) => prev.map((row) => (row.id === id ? payload.alert : row)));
      } catch {
        setErrorById((prev) => ({ ...prev, [id]: labels.transition_failed }));
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [labels.transition_409, labels.transition_failed],
  );

  const visible = useMemo(() => rows, [rows]);

  if (visible.length === 0) {
    return (
      <>
        <LiveRegion message={liveMessage} label={labels.live_label} />
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
          {labels.empty}
        </p>
      </>
    );
  }

  return (
    <>
      <LiveRegion message={liveMessage} label={labels.live_label} />
      <div style={{ overflowX: 'auto' }}>
        <table
          aria-label={labels.live_label}
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.875rem',
          }}
        >
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th scope="col" style={cellStyle}>
                {labels.th_severity}
              </th>
              <th scope="col" style={cellStyle}>
                {labels.th_actor}
              </th>
              <th scope="col" style={cellStyle}>
                {labels.th_summary}
              </th>
              <th scope="col" style={cellStyle}>
                {labels.th_detected}
              </th>
              <th scope="col" style={cellStyle}>
                {labels.th_state}
              </th>
              <th scope="col" style={cellStyle}>
                {labels.th_actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const summary = locale === 'fr' ? row.summary_fr : row.summary_en;
              const sevBg = SEVERITY_BG[row.severity] ?? '#475569';
              const stateBg = STATE_BG[row.state];
              const isBusy = busy.has(row.id);
              const err = errorById[row.id];
              return (
                <tr
                  key={row.id}
                  style={{ borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' }}
                >
                  <td style={cellStyle}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '999px',
                        background: sevBg,
                        color: 'white',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      {readableSeverity(row.severity, labels)}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {row.actor_id}
                  </td>
                  <td style={cellStyle}>
                    <div>{summary}</div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                      {row.kind} · {labels.th_actor.toLowerCase()}: {row.triggering_event_count} ·
                      rule {row.rule_version}
                    </div>
                    {err ? (
                      <div
                        role="alert"
                        style={{
                          marginTop: '0.375rem',
                          padding: '0.25rem 0.5rem',
                          background: '#fef2f2',
                          color: '#991b1b',
                          fontSize: '0.75rem',
                          borderRadius: '0.25rem',
                        }}
                      >
                        {err}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {row.detected_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: stateBg,
                        color: 'white',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {readableState(row.state, labels)}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      <ActionBtn
                        disabled={isBusy || row.state === 'acknowledged'}
                        label={labels.btn_acknowledge}
                        onClick={() => transition(row.id, 'acknowledged')}
                        variant="primary"
                        busy={isBusy}
                        busyLabel={labels.busy}
                      />
                      <ActionBtn
                        disabled={isBusy || row.state === 'dismissed'}
                        label={labels.btn_dismiss}
                        onClick={() => transition(row.id, 'dismissed')}
                        variant="muted"
                        busy={isBusy}
                        busyLabel={labels.busy}
                      />
                      <ActionBtn
                        disabled={isBusy || row.state === 'promoted_to_finding'}
                        label={labels.btn_promote}
                        onClick={() => transition(row.id, 'promoted_to_finding')}
                        variant="success"
                        busy={isBusy}
                        busyLabel={labels.busy}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LiveRegion({ message, label }: { message: string; label: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {message}
    </div>
  );
}

function ActionBtn(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly variant: 'primary' | 'muted' | 'success';
  readonly busy: boolean;
  readonly busyLabel: string;
}): JSX.Element {
  const bg =
    props.variant === 'primary' ? '#1f2937' : props.variant === 'success' ? '#15803d' : '#e5e7eb';
  const fg = props.variant === 'muted' ? '#374151' : 'white';
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy}
      style={{
        padding: '0.25rem 0.5rem',
        fontSize: '0.75rem',
        borderRadius: '0.25rem',
        border: '1px solid #d1d5db',
        background: props.disabled ? '#f3f4f6' : bg,
        color: props.disabled ? '#9ca3af' : fg,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {props.busy ? props.busyLabel : props.label}
    </button>
  );
}

function readableSeverity(s: AlertRow['severity'], labels: AlertsTableLabels): string {
  switch (s) {
    case 'critical':
      return labels.severity_critical;
    case 'high':
      return labels.severity_high;
    case 'medium':
      return labels.severity_medium;
    case 'low':
      return labels.severity_low;
    case 'info':
      return labels.severity_info;
  }
}

function readableState(s: AlertState, labels: AlertsTableLabels): string {
  switch (s) {
    case 'open':
      return labels.state_open;
    case 'acknowledged':
      return labels.state_acknowledged;
    case 'dismissed':
      return labels.state_dismissed;
    case 'promoted_to_finding':
      return labels.state_promoted;
  }
}

const cellStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
};
