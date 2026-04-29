import { describe, expect, it } from 'vitest';

import { ALL_RULES, evaluateAnomalies, type AnomalyEvent } from '../src/anomaly.js';

const ev = (over: Partial<AnomalyEvent>): AnomalyEvent => ({
  event_id: crypto.randomUUID(),
  event_type: 'search.entity',
  category: 'B',
  timestamp_utc: '2026-04-29T10:00:00.000Z',
  actor_id: 'user-1',
  actor_role: 'operator',
  actor_ip: '10.0.0.1',
  target_resource: 'opposition-leader',
  result_status: 'success',
  ...over,
});

describe('evaluateAnomalies', () => {
  it('every documented rule appears in ALL_RULES', () => {
    expect(ALL_RULES.length).toBe(10);
  });

  it('fires fishing_query_pattern when 3+ identical searches with no dossier access', () => {
    const events = Array.from({ length: 4 }).map((_, i) =>
      ev({
        timestamp_utc: `2026-04-29T10:0${i}:00.000Z`,
        target_resource: 'opposition-leader',
      }),
    );
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'fishing_query_pattern')).toBe(true);
  });

  it('does NOT fire fishing pattern when there is dossier follow-up', () => {
    const events: AnomalyEvent[] = [
      ev({ timestamp_utc: '2026-04-29T10:00:00.000Z' }),
      ev({ timestamp_utc: '2026-04-29T10:01:00.000Z' }),
      ev({ timestamp_utc: '2026-04-29T10:02:00.000Z' }),
      ev({
        timestamp_utc: '2026-04-29T10:03:00.000Z',
        category: 'C',
        event_type: 'dossier.opened',
      }),
    ];
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'fishing_query_pattern')).toBe(false);
  });

  it('fires after_hours_dossier_access for category-C events outside 07–17 UTC', () => {
    const events = [
      ev({
        category: 'C',
        event_type: 'dossier.opened',
        timestamp_utc: '2026-04-29T22:00:00.000Z',
      }),
    ];
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'after_hours_dossier_access')).toBe(true);
  });

  it('fires analyst_clearance_uniform when 10+ decisions are 100% cleared', () => {
    const events = Array.from({ length: 10 }).map((_, i) =>
      ev({
        actor_id: 'analyst-1',
        actor_role: 'analyst',
        category: 'D',
        event_type: 'analyst.cleared',
        timestamp_utc: `2026-04-29T1${i}:00:00.000Z`,
      }),
    );
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'analyst_clearance_uniform' && a.severity === 'high')).toBe(true);
  });

  it('fires council_repeated_abstention on 3+ abstentions', () => {
    const events = Array.from({ length: 3 }).map((_, i) =>
      ev({
        actor_id: 'pillar-civ-1',
        actor_role: 'pillar_civil_society',
        category: 'D',
        event_type: 'vote.abstained',
        timestamp_utc: `2026-04-29T1${i}:00:00.000Z`,
      }),
    );
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'council_repeated_abstention')).toBe(true);
  });

  it('fires auth_burst_new_ip for 5+ auths from a single new IP (with prior IP history)', () => {
    const priorIp = ev({
      category: 'A',
      event_type: 'auth.login_succeeded',
      actor_ip: '203.0.113.1',
      timestamp_utc: '2026-04-29T07:00:00.000Z',
    });
    const burst = Array.from({ length: 5 }).map((_, i) =>
      ev({
        category: 'A',
        event_type: 'auth.login_succeeded',
        actor_ip: '198.51.100.5',
        timestamp_utc: `2026-04-29T0${i + 8}:00:00.000Z`,
      }),
    );
    const r = evaluateAnomalies([priorIp, ...burst]);
    expect(r.some((a) => a.kind === 'auth_burst_new_ip' && a.severity === 'critical')).toBe(true);
  });

  it('fires export_volume_spike on 10+ exports', () => {
    const events = Array.from({ length: 11 }).map((_, i) =>
      ev({
        category: 'C',
        event_type: 'dossier.exported_pdf',
        timestamp_utc: `2026-04-29T1${i % 10}:00:00.000Z`,
      }),
    );
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'export_volume_spike' && a.severity === 'critical')).toBe(true);
  });

  it('fires yubikey_geographic_improbable when same actor authenticates from 3+ IPs', () => {
    const events = ['10.0.0.1', '198.51.100.2', '203.0.113.3'].map((ip, i) =>
      ev({
        category: 'A',
        event_type: 'auth.login_succeeded',
        actor_ip: ip,
        timestamp_utc: `2026-04-29T1${i}:00:00.000Z`,
      }),
    );
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'yubikey_geographic_improbable' && a.severity === 'critical')).toBe(
      true,
    );
  });

  it('fires sensitive_entity_query when watchlist matches', () => {
    process.env.AUDIT_WATCHLIST_ENTITIES = 'highly-sensitive-name';
    const events = [
      ev({
        category: 'B',
        event_type: 'search.entity',
        target_resource: 'q=highly-sensitive-name',
      }),
    ];
    const r = evaluateAnomalies(events);
    expect(r.some((a) => a.kind === 'sensitive_entity_query')).toBe(true);
    delete process.env.AUDIT_WATCHLIST_ENTITIES;
  });

  it('emits no false alerts on a benign event log', () => {
    const events = [
      ev({
        category: 'A',
        event_type: 'auth.login_succeeded',
        timestamp_utc: '2026-04-29T08:00:00.000Z',
      }),
      ev({
        category: 'C',
        event_type: 'dossier.opened',
        timestamp_utc: '2026-04-29T09:00:00.000Z',
      }),
      ev({
        category: 'D',
        event_type: 'signature.applied',
        timestamp_utc: '2026-04-29T09:30:00.000Z',
      }),
    ];
    const r = evaluateAnomalies(events);
    expect(r.length).toBe(0);
  });
});
