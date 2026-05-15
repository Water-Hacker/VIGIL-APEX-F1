import Link from 'next/link';

import { listFindings } from '@/lib/findings.server';
import {
  generateCopilotSuggestion,
  type CopilotClassification,
  type FindingSnapshotForCopilot,
} from '@/lib/triage-copilot/copilot';

export const dynamic = 'force-dynamic';

function tierBadge(tier: string | null): { label: string; tone: string } | null {
  if (tier === null) return null;
  if (tier === 'action_queue') return { label: 'ACTION', tone: '#fee2e2;color:#7f1d1d' };
  if (tier === 'investigation_queue') return { label: 'INVEST', tone: '#fef3c7;color:#78350f' };
  return { label: 'LOG', tone: '#f3f4f6;color:#374151' };
}

function classificationStyle(c: CopilotClassification): { label: string; bg: string; fg: string } {
  switch (c) {
    case 'escalate':
      return { label: 'ESCALATE', bg: '#dcfce7', fg: '#14532d' };
    case 'hold':
      return { label: 'HOLD', bg: '#fef3c7', fg: '#78350f' };
    case 'dismiss':
      return { label: 'DISMISS', bg: '#e2e8f0', fg: '#475569' };
  }
}

export default async function FindingsPage(): Promise<JSX.Element> {
  const rows = await listFindings({ limit: 50 });
  const now = new Date();

  const enriched = rows
    .map((r) => {
      const snapshot: FindingSnapshotForCopilot = {
        finding_id: r.id,
        posterior: r.posterior ?? 0,
        signal_count: r.signal_count,
        primary_pattern_category: r.primary_pattern_category,
        signal_categories: r.primary_pattern_category ? [r.primary_pattern_category] : [],
        severity: (r.severity as 'low' | 'medium' | 'high' | 'critical') ?? 'low',
        created_at: r.detected_at,
        tip_linked: false,
        external_press_mentions: 0,
        entity_is_sanctioned_or_pep: r.entity_is_pep_or_sanctioned,
        counter_evidence_coherent: r.counter_evidence_present,
      };
      return { row: r, suggestion: generateCopilotSuggestion(snapshot, now) };
    })
    .sort((a, b) => b.suggestion.urgency_score - a.suggestion.urgency_score);

  return (
    <main>
      <h1>Findings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Operations Room — findings above 0.55 posterior, ranked by triage co-pilot urgency. SRD
        §27.3 + AI-SAFETY-DOCTRINE-v1 §A.4 + FRONTIER-AUDIT E1.6.
      </p>
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Posterior</th>
            <th>Tier</th>
            <th>Co-pilot</th>
            <th>Urgency</th>
            <th>State</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map(({ row: r, suggestion }) => {
            const tier = tierBadge(r.tier);
            const cls = classificationStyle(suggestion.classification);
            const urgencyPct = Math.round(suggestion.urgency_score * 100);
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/findings/${r.id}`}>{r.id.slice(0, 8)}</Link>
                </td>
                <td>{r.title_fr}</td>
                <td>
                  <span
                    className={`classification-banner cls-${r.severity === 'critical' ? 'restreint' : r.severity === 'high' ? 'confidentiel' : 'public'}`}
                  >
                    {r.severity}
                  </span>
                </td>
                <td>
                  <div style={{ width: 120 }}>
                    <div className="posterior-bar">
                      <div style={{ width: `${(r.posterior ?? 0) * 100}%` }} />
                    </div>
                    <small>{(r.posterior ?? 0).toFixed(2)}</small>
                  </div>
                </td>
                <td>
                  {tier ? (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.1rem 0.4rem',
                        borderRadius: 4,
                        background: tier.tone.split(';')[0],
                        color: tier.tone.split(';')[1]?.replace('color:', '') ?? '#000',
                      }}
                    >
                      {tier.label}
                    </span>
                  ) : (
                    <small style={{ color: 'var(--muted)' }}>—</small>
                  )}
                </td>
                <td>
                  <span
                    title={suggestion.rationale}
                    style={{
                      display: 'inline-block',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.4rem',
                      borderRadius: 4,
                      background: cls.bg,
                      color: cls.fg,
                    }}
                  >
                    {cls.label}
                  </span>
                </td>
                <td>
                  <div style={{ width: 80 }}>
                    <div className="posterior-bar">
                      <div style={{ width: `${urgencyPct}%` }} />
                    </div>
                    <small className="tabular-nums">{urgencyPct}</small>
                  </div>
                </td>
                <td>{r.state}</td>
                <td>{new Date(r.detected_at).toLocaleString('fr-CM')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
