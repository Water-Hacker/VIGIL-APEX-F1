/**
 * Tip disposition transition graph tests — the closed-set transition
 * rules enforced by the repo + the database trigger (DECISION-016).
 *
 * The DB-side delete-block + history-table append-only triggers are
 * SQL; integration tests against a live Postgres are covered by the
 * dr-rehearsal smoke tests. This file pins the pure-TypeScript half:
 * the transition graph + REDACTED_BY_COURT_ORDER terminal property.
 */
import { describe, expect, it } from 'vitest';

import { TIP_DISPOSITION_TRANSITIONS, isAllowedTransition } from '../src/repos/tip.js';

describe('tip disposition transition graph', () => {
  it('forbids self-transitions', () => {
    expect(isAllowedTransition('NEW', 'NEW')).toBe(false);
    expect(isAllowedTransition('IN_TRIAGE', 'IN_TRIAGE')).toBe(false);
    expect(isAllowedTransition('REDACTED_BY_COURT_ORDER', 'REDACTED_BY_COURT_ORDER')).toBe(false);
  });

  it('NEW → IN_TRIAGE is allowed (canonical happy path)', () => {
    expect(isAllowedTransition('NEW', 'IN_TRIAGE')).toBe(true);
  });

  it('IN_TRIAGE → DISMISSED / ARCHIVED / PROMOTED all allowed', () => {
    expect(isAllowedTransition('IN_TRIAGE', 'DISMISSED')).toBe(true);
    expect(isAllowedTransition('IN_TRIAGE', 'ARCHIVED')).toBe(true);
    expect(isAllowedTransition('IN_TRIAGE', 'PROMOTED')).toBe(true);
  });

  it('IN_TRIAGE → NEW is forbidden (no regression to NEW)', () => {
    expect(isAllowedTransition('IN_TRIAGE', 'NEW')).toBe(false);
  });

  it('REDACTED_BY_COURT_ORDER is terminal — every outbound transition forbidden', () => {
    const dispositions = ['NEW', 'IN_TRIAGE', 'DISMISSED', 'ARCHIVED', 'PROMOTED'];
    for (const d of dispositions) {
      expect(
        isAllowedTransition('REDACTED_BY_COURT_ORDER', d),
        `must NOT allow REDACTED_BY_COURT_ORDER → ${d}`,
      ).toBe(false);
    }
  });

  it('every disposition is a key in the transition graph', () => {
    const dispositions = [
      'NEW',
      'IN_TRIAGE',
      'DISMISSED',
      'ARCHIVED',
      'PROMOTED',
      'REDACTED_BY_COURT_ORDER',
    ];
    for (const d of dispositions) {
      expect(TIP_DISPOSITION_TRANSITIONS[d]).toBeDefined();
    }
  });

  it('every disposition can transition into REDACTED_BY_COURT_ORDER (court redaction always available)', () => {
    const dispositions = ['NEW', 'IN_TRIAGE', 'DISMISSED', 'ARCHIVED', 'PROMOTED'];
    for (const d of dispositions) {
      expect(
        isAllowedTransition(d, 'REDACTED_BY_COURT_ORDER'),
        `${d} must be redactable under court order`,
      ).toBe(true);
    }
  });

  it('rejects transitions to invented dispositions', () => {
    expect(isAllowedTransition('NEW', 'DELETED')).toBe(false);
    expect(isAllowedTransition('NEW', 'DROPPED')).toBe(false);
    expect(isAllowedTransition('PROMOTED', 'UNKNOWN')).toBe(false);
  });

  it('ARCHIVED is terminal except for court-ordered redaction', () => {
    expect(isAllowedTransition('ARCHIVED', 'NEW')).toBe(false);
    expect(isAllowedTransition('ARCHIVED', 'IN_TRIAGE')).toBe(false);
    expect(isAllowedTransition('ARCHIVED', 'PROMOTED')).toBe(false);
    expect(isAllowedTransition('ARCHIVED', 'REDACTED_BY_COURT_ORDER')).toBe(true);
  });
});
