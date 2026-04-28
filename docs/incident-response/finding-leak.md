# IR-02 — Operator-only finding leaked publicly

**Severity:** critical. **Roles needed:** architect, technical-pillar
council member, legal counsel (out-of-band).

A finding with `state IN ('detected', 'review', 'council_review')` —
i.e. **before** the 3-of-5 council vote — appears on a public surface,
in social media, or in a leaked document. The council has not yet
deliberated; circulating it presumptively damages the named entities.

## Triage (target: 30 min)

1. **Confirm the leak source.** Capture URL / screenshot / message ID.
2. **Identify the finding ID.** Match against `finding.finding` to
   confirm it is a real VIGIL APEX-issued finding rather than a forged
   document. Use [tools/verify-dossier.sh](../../tools/verify-dossier.sh)
   if a PDF was leaked: a forgery will fail the Polygon-anchor check.
3. **Pause the council vote** if one is open. The architect calls a
   30-day extension via
   `VIGILGovernance.extendVoteWindow(proposalIndex)`.

## Containment (1 hr)

4. **Public verify-page surface.** A pre-vote finding is NOT exposed
   on `/verify/...`; if one is, the leak path is internal — go straight
   to "Eradication" below. If it's not exposed, the leak is upstream
   of VIGIL APEX (operator account compromise, browser screenshot,
   physical theft of a printed dossier).
5. **Audit-log forensics:**
   ```sql
   SELECT actor, occurred_at, payload
     FROM audit.actions
    WHERE subject_id = '<FINDING_ID>'
    ORDER BY seq ASC;
   ```
   Cross-reference with `audit.vault_log` (Phase E7) to find any
   secret read against `secret/vigil/findings/<id>`.

## Eradication

6. **Rotate the operator's Keycloak credentials and YubiKey.** Use the
   F10 quarterly key-rotation timer manually:
   ```sh
   sudo /usr/local/bin/vigil-key-rotation operator <username>
   ```
7. **File a Cameroon-specific data-protection notice** with ANTIC if
   the leak includes PII per Article 41 of the 2010 cybersecurity law.

## Recovery

8. **Council emergency session.** The technical pillar convenes the
   five members; the finding is voted on the original schedule unless
   the leak prejudices a member, in which case that member recuses
   (`VIGILGovernance.recuse(proposalIndex)`).
9. **Public statement.** Bilingual FR/EN, posted at
   `https://vigilapex.cm/communique/<date>` and on
   the verify surface. Template at `docs/communiques/leak-template.md`.

## Postmortem

10. Within 14 days, postmortem in `docs/incident-response/postmortems/`.
    Mandatory contents per EXEC §35.4:
    - root cause (technical, procedural, or human)
    - what controls failed
    - what specific changes (code, ops, training) prevent recurrence
    - sign-off by 3 of 5 council members
