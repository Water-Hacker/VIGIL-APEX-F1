import { describe, expect, it } from 'vitest';

import {
  generateCopilotSuggestion,
  sortByCopilotUrgency,
  type FindingSnapshotForCopilot,
} from '../src/lib/triage-copilot/copilot.js';

const baseFinding = (over: Partial<FindingSnapshotForCopilot> = {}): FindingSnapshotForCopilot => ({
  finding_id: 'finding-001',
  posterior: 0.7,
  signal_count: 4,
  primary_pattern_category: 'A',
  signal_categories: ['A'],
  severity: 'high',
  created_at: '2026-05-10T00:00:00Z',
  tip_linked: false,
  external_press_mentions: 0,
  entity_is_sanctioned_or_pep: false,
  ...over,
});

const NOW = new Date('2026-05-14T12:00:00Z');

describe('generateCopilotSuggestion (E1.6 closure)', () => {
  it('escalates when CONAC threshold is met', () => {
    const s = generateCopilotSuggestion(baseFinding({ posterior: 0.96, signal_count: 6 }), NOW);
    expect(s.classification).toBe('escalate');
    expect(s.inputs.conac_threshold_met).toBe(true);
    expect(s.top_next_actions[0]).toMatch(/counter-evidence/i);
  });

  it('holds when counter-evidence is coherent even if threshold otherwise met', () => {
    const s = generateCopilotSuggestion(
      baseFinding({ posterior: 0.96, signal_count: 6, counter_evidence_coherent: true }),
      NOW,
    );
    expect(s.classification).toBe('hold');
    expect(s.rationale).toMatch(/counter-evidence is coherent/);
  });

  it('holds when adversarial pipeline raised hold reasons', () => {
    const s = generateCopilotSuggestion(
      baseFinding({
        posterior: 0.96,
        signal_count: 6,
        hold_reasons: ['order_randomisation_disagreement'],
      }),
      NOW,
    );
    expect(s.classification).toBe('hold');
    expect(s.rationale).toMatch(/order_randomisation/);
  });

  it('dismisses low-posterior + low-signal findings', () => {
    const s = generateCopilotSuggestion(baseFinding({ posterior: 0.3, signal_count: 1 }), NOW);
    expect(s.classification).toBe('dismiss');
    expect(s.rationale).toMatch(/false positive/);
  });

  it('holds borderline findings (between dismiss and escalate)', () => {
    const s = generateCopilotSuggestion(baseFinding({ posterior: 0.8, signal_count: 3 }), NOW);
    expect(s.classification).toBe('hold');
  });

  it('urgency boosted for sanctioned-entity findings', () => {
    const baseS = generateCopilotSuggestion(baseFinding(), NOW);
    const sanctionedS = generateCopilotSuggestion(
      baseFinding({ entity_is_sanctioned_or_pep: true }),
      NOW,
    );
    expect(sanctionedS.urgency_score).toBeGreaterThan(baseS.urgency_score);
  });

  it('urgency boosted for tip-linked findings', () => {
    const baseS = generateCopilotSuggestion(baseFinding(), NOW);
    const tipS = generateCopilotSuggestion(baseFinding({ tip_linked: true }), NOW);
    expect(tipS.urgency_score).toBeGreaterThan(baseS.urgency_score);
  });

  it('urgency boosted for high-posterior findings', () => {
    const baseS = generateCopilotSuggestion(baseFinding(), NOW);
    const strongS = generateCopilotSuggestion(baseFinding({ posterior: 0.97 }), NOW);
    expect(strongS.urgency_score).toBeGreaterThan(baseS.urgency_score);
  });

  it('stale findings get urgency boost', () => {
    const freshS = generateCopilotSuggestion(
      baseFinding({ created_at: '2026-05-13T00:00:00Z' }),
      NOW,
    );
    const staleS = generateCopilotSuggestion(
      baseFinding({ created_at: '2026-03-01T00:00:00Z' }),
      NOW,
    );
    expect(staleS.urgency_score).toBeGreaterThan(freshS.urgency_score);
    expect(staleS.rationale).toMatch(/stale/);
  });

  it('critical severity gets the highest baseline urgency', () => {
    const lowS = generateCopilotSuggestion(baseFinding({ severity: 'low' }), NOW);
    const criticalS = generateCopilotSuggestion(baseFinding({ severity: 'critical' }), NOW);
    expect(criticalS.urgency_score).toBeGreaterThan(lowS.urgency_score);
  });

  it('top_next_actions includes cross-reference for tip-linked findings', () => {
    const s = generateCopilotSuggestion(baseFinding({ tip_linked: true }), NOW);
    expect(s.top_next_actions[0]).toMatch(/cross-reference linked tip/i);
  });

  it('escalate actions include opening council proposal', () => {
    const s = generateCopilotSuggestion(baseFinding({ posterior: 0.96, signal_count: 6 }), NOW);
    expect(s.top_next_actions.some((a) => /council proposal/i.test(a))).toBe(true);
  });

  it('inputs object exposes the threshold decision for audit row payload', () => {
    const s = generateCopilotSuggestion(baseFinding({ posterior: 0.96, signal_count: 6 }), NOW);
    expect(s.inputs.conac_threshold_met).toBe(true);
    expect(s.inputs.posterior).toBe(0.96);
    expect(s.inputs.signal_count).toBe(6);
  });
});

describe('sortByCopilotUrgency', () => {
  it('orders findings by urgency descending', () => {
    const findings = [
      baseFinding({ finding_id: 'a', severity: 'low' }),
      baseFinding({ finding_id: 'b', severity: 'critical', entity_is_sanctioned_or_pep: true }),
      baseFinding({ finding_id: 'c', severity: 'medium' }),
    ];
    const sorted = sortByCopilotUrgency(findings, NOW);
    expect(sorted[0]!.finding.finding_id).toBe('b');
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.suggestion.urgency_score).toBeLessThanOrEqual(
        sorted[i - 1]!.suggestion.urgency_score,
      );
    }
  });

  it('returns empty array on empty input', () => {
    const sorted = sortByCopilotUrgency([], NOW);
    expect(sorted).toHaveLength(0);
  });
});
