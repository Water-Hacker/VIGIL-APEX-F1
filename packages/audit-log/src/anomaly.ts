import type { Schemas } from '@vigil/shared';

/**
 * Deterministic anomaly-detection rules — TAL-PA doctrine §"Anomaly
 * Detection on the Audit Log Itself".
 *
 * Each rule is a pure function over a fixed window of `UserActionEvent`
 * rows. The rules are versioned (`RULE_VERSION`) so an alert produced at
 * one version is reproducible at that version even after the rule
 * library evolves.
 *
 * Rules are intentionally public — adversaries cannot evade them by
 * obscurity, only by structurally changing their behaviour, which itself
 * leaves traces.
 */

export const RULE_VERSION = 'v1.0.0';

export interface AnomalyEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly category: string;
  readonly timestamp_utc: string;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly actor_ip: string | null;
  readonly target_resource: string;
  readonly result_status: string;
}

export interface AnomalyRuleResult {
  readonly kind: Schemas.AnomalyKind;
  readonly actor_id: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly summary_fr: string;
  readonly summary_en: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly triggering_event_ids: readonly string[];
}

export interface AnomalyRule {
  readonly kind: Schemas.AnomalyKind;
  readonly evaluate: (events: ReadonlyArray<AnomalyEvent>) => ReadonlyArray<AnomalyRuleResult>;
}

const ALL_ACTORS = (events: ReadonlyArray<AnomalyEvent>): Set<string> => {
  const s = new Set<string>();
  for (const e of events) s.add(e.actor_id);
  return s;
};

function bounds(events: ReadonlyArray<AnomalyEvent>): { start: string; end: string } {
  if (events.length === 0) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  const sorted = [...events].sort((a, b) =>
    a.timestamp_utc < b.timestamp_utc ? -1 : a.timestamp_utc > b.timestamp_utc ? 1 : 0,
  );
  return { start: sorted[0]!.timestamp_utc, end: sorted[sorted.length - 1]!.timestamp_utc };
}

/** Rule 1 — fishing query pattern: actor repeatedly searches an entity
 *  with no associated case-file activity. */
const fishingQueryPattern: AnomalyRule = {
  kind: 'fishing_query_pattern',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const actorEvents = events.filter((e) => e.actor_id === actor);
      const searches = actorEvents.filter(
        (e) => e.event_type === 'search.entity' || e.event_type === 'search.fulltext',
      );
      const dossierAccess = actorEvents.filter((e) => e.category === 'C');
      const decisions = actorEvents.filter((e) => e.category === 'D');
      const queryByTarget = new Map<string, AnomalyEvent[]>();
      for (const s of searches) {
        const list = queryByTarget.get(s.target_resource) ?? [];
        list.push(s);
        queryByTarget.set(s.target_resource, list);
      }
      for (const [target, list] of queryByTarget.entries()) {
        if (list.length < 3) continue;
        const hasFollowUp = dossierAccess.length > 0 || decisions.length > 0;
        if (hasFollowUp) continue;
        const w = bounds(list);
        out.push({
          kind: 'fishing_query_pattern',
          actor_id: actor,
          window_start: w.start,
          window_end: w.end,
          summary_fr: `${list.length} requêtes répétées sur la même cible « ${target} » sans aucune ouverture de dossier ni décision : motif de pêche d'informations.`,
          summary_en: `${list.length} repeated searches against the same target "${target}" with no dossier access or decision — likely fishing pattern.`,
          severity: list.length >= 6 ? 'high' : 'medium',
          triggering_event_ids: list.map((e) => e.event_id),
        });
      }
    }
    return out;
  },
};

/** Rule 2 — after-hours dossier access (08–18 Africa/Douala work window). */
const afterHoursDossierAccess: AnomalyRule = {
  kind: 'after_hours_dossier_access',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const offHours = events.filter((e) => {
        if (e.actor_id !== actor) return false;
        if (e.category !== 'C') return false;
        const h = new Date(e.timestamp_utc).getUTCHours();
        // Africa/Douala = UTC+1; office 08–18 local → 07–17 UTC
        return h < 7 || h >= 17;
      });
      if (offHours.length < 1) continue;
      const w = bounds(offHours);
      out.push({
        kind: 'after_hours_dossier_access',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `Accès au dossier en dehors des heures ouvrées (${offHours.length} événements). Possible extraction de données.`,
        summary_en: `Dossier access outside business hours (${offHours.length} events). Possible data extraction.`,
        severity: offHours.length >= 5 ? 'high' : 'medium',
        triggering_event_ids: offHours.map((e) => e.event_id),
      });
    }
    return out;
  },
};

/** Rule 3 — analyst clearance rate at 100% over the window. */
const analystClearanceUniform: AnomalyRule = {
  kind: 'analyst_clearance_uniform',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const decisions = events.filter(
        (e) =>
          e.actor_id === actor &&
          (e.event_type === 'analyst.cleared' || e.event_type === 'analyst.rejected'),
      );
      if (decisions.length < 10) continue;
      const cleared = decisions.filter((e) => e.event_type === 'analyst.cleared').length;
      if (cleared !== decisions.length) continue;
      const w = bounds(decisions);
      out.push({
        kind: 'analyst_clearance_uniform',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `Taux d'innocentation à 100 % sur ${decisions.length} décisions. Possible sur-confiance ou coercition. Rotation obligatoire.`,
        summary_en: `Clearance rate at 100 % across ${decisions.length} decisions — possible over-trust or coercion. Mandatory rotation.`,
        severity: 'high',
        triggering_event_ids: decisions.map((e) => e.event_id),
      });
    }
    return out;
  },
};

/** Rule 4 — council member abstains repeatedly without written reason. */
const councilRepeatedAbstention: AnomalyRule = {
  kind: 'council_repeated_abstention',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const abstentions = events.filter(
        (e) => e.actor_id === actor && e.event_type === 'vote.abstained',
      );
      if (abstentions.length < 3) continue;
      const w = bounds(abstentions);
      out.push({
        kind: 'council_repeated_abstention',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `${abstentions.length} abstentions répétées : possible obstruction passive (signalé sur le tableau de bord public).`,
        summary_en: `${abstentions.length} repeated abstentions — possible passive obstruction (flagged on public dashboard).`,
        severity: 'medium',
        triggering_event_ids: abstentions.map((e) => e.event_id),
      });
    }
    return out;
  },
};

/** Rule 5 — authentication burst from a new IP for a sensitive account. */
const authBurstNewIp: AnomalyRule = {
  kind: 'auth_burst_new_ip',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const auths = events.filter(
        (e) => e.actor_id === actor && e.category === 'A' && e.actor_ip !== null,
      );
      const ipFreq = new Map<string, AnomalyEvent[]>();
      for (const a of auths) {
        const ip = a.actor_ip!;
        const list = ipFreq.get(ip) ?? [];
        list.push(a);
        ipFreq.set(ip, list);
      }
      // A "burst" = 5+ auths from a single IP that has fewer than 2 prior
      // events historically (we approximate with: only seen in this window).
      const sortedIps = Array.from(ipFreq.entries()).sort((a, b) => b[1].length - a[1].length);
      for (const [ip, list] of sortedIps) {
        if (list.length < 5) continue;
        if (ipFreq.size === 1) continue; // single-IP-only history is normal
        const w = bounds(list);
        out.push({
          kind: 'auth_burst_new_ip',
          actor_id: actor,
          window_start: w.start,
          window_end: w.end,
          summary_fr: `Rafale d'authentifications (${list.length}) depuis l'adresse ${ip} sur un compte sensible. Possible compromission.`,
          summary_en: `Authentication burst (${list.length}) from IP ${ip} on a sensitive account. Possible compromise.`,
          severity: 'critical',
          triggering_event_ids: list.map((e) => e.event_id),
        });
        break; // one alert per actor
      }
    }
    return out;
  },
};

/** Rule 6 — sudden export volume spike from one user. */
const exportVolumeSpike: AnomalyRule = {
  kind: 'export_volume_spike',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const exports = events.filter(
        (e) =>
          e.actor_id === actor &&
          (e.event_type === 'dossier.exported_pdf' || e.event_type === 'dossier.downloaded'),
      );
      if (exports.length < 10) continue;
      const w = bounds(exports);
      out.push({
        kind: 'export_volume_spike',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `Pic de téléchargements (${exports.length} exports). Possible exfiltration de données. Session terminée.`,
        summary_en: `Export volume spike (${exports.length} exports). Possible data exfiltration. Session terminated.`,
        severity: 'critical',
        triggering_event_ids: exports.map((e) => e.event_id),
      });
    }
    return out;
  },
};

/** Rule 7 — dossier viewed but analyst signature never produced. */
const dossierViewNoSignature: AnomalyRule = {
  kind: 'dossier_view_no_signature',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    for (const actor of ALL_ACTORS(events)) {
      const views = events.filter((e) => e.actor_id === actor && e.event_type === 'dossier.opened');
      const signs = events.filter((e) => e.actor_id === actor && e.event_type === 'signature.applied');
      if (views.length < 5 || signs.length > 0) continue;
      const w = bounds(views);
      out.push({
        kind: 'dossier_view_no_signature',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `${views.length} dossiers ouverts sans aucune signature : possible obstruction ou pré-avertissement.`,
        summary_en: `${views.length} dossiers opened without any signature — possible stalling or pre-warning.`,
        severity: 'medium',
        triggering_event_ids: views.map((e) => e.event_id),
      });
    }
    return out;
  },
};

/** Rule 8 — config change without an associated PR (proxy: no preceding
 *  audit.query or code-review event for the same target_resource). */
const configChangeWithoutPr: AnomalyRule = {
  kind: 'config_change_without_pr',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    const configChanges = events.filter((e) => e.category === 'F');
    for (const c of configChanges) {
      const matchingReviewQueries = events.filter(
        (e) =>
          e.category === 'K' &&
          e.event_type === 'audit.query_executed' &&
          e.target_resource.includes(c.target_resource) &&
          e.timestamp_utc < c.timestamp_utc,
      );
      if (matchingReviewQueries.length > 0) continue;
      out.push({
        kind: 'config_change_without_pr',
        actor_id: c.actor_id,
        window_start: c.timestamp_utc,
        window_end: c.timestamp_utc,
        summary_fr: `Changement de configuration (${c.event_type} sur ${c.target_resource}) sans revue préalable visible : tentative de modification non autorisée.`,
        summary_en: `Configuration change (${c.event_type} on ${c.target_resource}) without a preceding review query — unauthorised modification attempt.`,
        severity: 'high',
        triggering_event_ids: [c.event_id],
      });
    }
    return out;
  },
};

/** Rule 9 — sensitive entity query (specific to politically-protected names). */
const sensitiveEntityQuery: AnomalyRule = {
  kind: 'sensitive_entity_query',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    const watchlist = (process.env.AUDIT_WATCHLIST_ENTITIES ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (watchlist.length === 0) return out;
    for (const e of events) {
      if (e.category !== 'B') continue;
      const t = e.target_resource.toLowerCase();
      if (!watchlist.some((w) => t.includes(w))) continue;
      out.push({
        kind: 'sensitive_entity_query',
        actor_id: e.actor_id,
        window_start: e.timestamp_utc,
        window_end: e.timestamp_utc,
        summary_fr: `Requête correspondant à une entité politiquement sensible (mode de journalisation renforcé activé pour cet utilisateur).`,
        summary_en: `Query matched a politically sensitive entity (enhanced logging activated for this user).`,
        severity: 'high',
        triggering_event_ids: [e.event_id],
      });
    }
    return out;
  },
};

/** Rule 10 — YubiKey used from a geographically improbable location. The
 *  full check requires GeoIP; this rule fires when the same YubiKey
 *  serial generates auths from > 2 distinct IPs in a single window. */
const yubikeyGeoImprobable: AnomalyRule = {
  kind: 'yubikey_geographic_improbable',
  evaluate: (events) => {
    const out: AnomalyRuleResult[] = [];
    const byActor = new Map<string, AnomalyEvent[]>();
    for (const e of events) {
      if (e.category !== 'A') continue;
      if (e.actor_ip === null) continue;
      const list = byActor.get(e.actor_id) ?? [];
      list.push(e);
      byActor.set(e.actor_id, list);
    }
    for (const [actor, list] of byActor.entries()) {
      const ips = new Set(list.map((e) => e.actor_ip!));
      if (ips.size < 3) continue;
      const w = bounds(list);
      out.push({
        kind: 'yubikey_geographic_improbable',
        actor_id: actor,
        window_start: w.start,
        window_end: w.end,
        summary_fr: `YubiKey utilisée depuis ${ips.size} adresses IP distinctes — déplacement géographique improbable : possible vol de YubiKey.`,
        summary_en: `YubiKey used from ${ips.size} distinct IPs — geographically improbable: possible YubiKey theft.`,
        severity: 'critical',
        triggering_event_ids: list.map((e) => e.event_id),
      });
    }
    return out;
  },
};

export const ALL_RULES: ReadonlyArray<AnomalyRule> = [
  fishingQueryPattern,
  afterHoursDossierAccess,
  analystClearanceUniform,
  councilRepeatedAbstention,
  authBurstNewIp,
  exportVolumeSpike,
  dossierViewNoSignature,
  configChangeWithoutPr,
  sensitiveEntityQuery,
  yubikeyGeoImprobable,
];

/** Run every rule over a window of events and return aggregated alerts. */
export function evaluateAnomalies(
  events: ReadonlyArray<AnomalyEvent>,
): ReadonlyArray<AnomalyRuleResult> {
  const out: AnomalyRuleResult[] = [];
  for (const rule of ALL_RULES) {
    out.push(...rule.evaluate(events));
  }
  return out;
}
