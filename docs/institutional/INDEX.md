# Institutional artefact templates

These three templates are the architect's tools for unlocking Phase-2
entry. Each has a designated audience, a designated outcome, and a
list of fields the architect personalises before sending. They are
**templates, not signed documents** — every send produces an
audit-row in `audit.actions` (action: `institutional.send.*`) so
the chain reflects who reached out to whom and when.

| File | Audience | Outcome unlocked | Phase-2 dependency |
|---|---|---|---|
| [`conac-engagement-letter.md`](./conac-engagement-letter.md) | Commission Nationale Anti-Corruption (CONAC), Cameroon | Countersigned engagement scoping VIGIL APEX as a tier-1 dossier source | unlocks the Phase-2 "CONAC engagement letter countersigned" gate (ROADMAP) |
| [`antic-declaration.md`](./antic-declaration.md) | Agence Nationale des Technologies de l'Information et de la Communication (ANTIC), Cameroon | Filed declaration under Loi 2010/021 — required to lawfully process personal data on the platform | unlocks the Phase-2 "ANTIC declaration accepted (W-23)" gate |
| [`council-pillar-candidate-brief.md`](./council-pillar-candidate-brief.md) | Each of 5 council-pillar candidates (judicial, civil society, academic, technical, religious) | Signed commitment letter from each pillar — required for the 5-of-5 council that decides escalations under §22 of the v5.1 commercial agreement | unlocks "Council standup" (M4 of TRUTH.md §J) |
| [`council-phase-3-review.md`](./council-phase-3-review.md) | The constituted Governance Council (5 pillars) | 4-of-5 architectural-review approval of the Phase-3 federation architecture, before per-region cutover ceremonies begin | gates Phase-3 execution (`ROADMAP.md` §Phase 3) once CEMAC funding is released |

## How to use

1. Read the file. Every `<<FILL: ...>>` marker is a blank the architect
   fills in by hand. The legal/binding paragraphs are intentionally
   not parameterised — they were drafted around the v5.1 commercial
   agreement and ANTIC's published guidance.
2. Have the backup architect's lawyer review **before** sending the
   first one. EXEC §34.5 lawyer-of-record handles institutional mail.
3. Send each via the ministry-appropriate channel:
   - CONAC — paper, signed, by hand or registered post per their
     stated correspondence preference (no email-only).
   - ANTIC — their online portal at
     `https://www.antic.cm/declarations` per Loi 2010/021 art. 41.
   - Council candidates — bespoke channel (email + phone follow-up;
     no group send under any circumstance).
4. Append a row to `docs/decisions/log.md` in this shape:

   > `<DATE>` — Sent `<TEMPLATE>` to `<RECIPIENT>` via `<CHANNEL>`.
   > Architect signature (YubiKey-touched audit row id):
   > `<AUDIT_ROW_ID>`. Expected reply window: `<WEEKS>`.

5. Track replies in `docs/decisions/log.md` next to the send row.

## What is NOT in this directory

- The architect's signed correspondence record. Once a template ships,
  the signed copy lives in the architect's institutional file (not in
  this repo) and is mirrored on the council-quorum-encrypted backup
  at `/srv/vigil/architect-archive/` per EXEC §34.5.
- The backup-architect engagement letter (EXEC §34) — separate
  artefact, separate document, drafted with counsel.
- Press communiqués — when the platform reaches its public-launch
  milestone the press packet lives at `docs/press/`. Not yet drafted.
- The MOU drafts for MINFI / BEAC / ANIF — those are commercial
  instruments authored by counsel, not architect-templated. The
  architect's role is to send the engagement letter that triggers
  MOU drafting, not to draft the MOU itself.
