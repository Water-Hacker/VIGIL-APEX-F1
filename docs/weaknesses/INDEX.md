# Weakness Tracker — Index

This is the live status of the 27 weaknesses identified during assimilation
(2026-04-28). Each weakness has its own file with full text. The index gives
status at a glance.

**Status legend**: 🟥 unresolved · 🟧 in progress · 🟨 fix proposed · 🟩 fix committed · ⬛ deferred · 🟦 institutional gate (no-code)

Last reconciled: **2026-05-17** (W-14 graduation to 🟩 confirmed against 224-row corpus; T1–T11 sweep of TODO.md).

| ID              | Severity | Title                                                                 | Status                                                                                                                                                                                                                               |
| --------------- | -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [W-01](W-01.md) | High     | Host OS conflict (Ubuntu+LUKS2 vs Windows+BitLocker)                  | 🟩 committed in TRUTH                                                                                                                                                                                                                |
| [W-02](W-02.md) | Medium   | NAS model & RAID drift                                                | 🟩                                                                                                                                                                                                                                   |
| [W-03](W-03.md) | High     | YubiKey count drift (8 vs 5+3 vs 2)                                   | 🟩                                                                                                                                                                                                                                   |
| [W-04](W-04.md) | Low      | Pattern count drift (40+ vs 43)                                       | 🟩                                                                                                                                                                                                                                   |
| [W-05](W-05.md) | Medium   | Source count drift (22 vs 26 vs 27)                                   | 🟩 — 27 reconciled in DECISION-008; TRUTH §C amended                                                                                                                                                                                 |
| [W-06](W-06.md) | High     | PPTX vs SRD/MVP — no architectural bridge                             | 🟩 ROADMAP.md phase tagging                                                                                                                                                                                                          |
| [W-07](W-07.md) | Critical | Build Companion v1 missing from working dir                           | 🟩 located + extracted                                                                                                                                                                                                               |
| [W-08](W-08.md) | High     | OpenPGP signing key has no break-glass                                | 🟦 institutional (off-jurisdiction safe-deposit-box selection — architect)                                                                                                                                                           |
| [W-09](W-09.md) | High     | Tip portal is Tor-friendly not Tor-native                             | 🟩 onion v3 + PoW + obfs4 (`infra/docker/tor/torrc`, `infra/docker/adapter-runner/torrc`)                                                                                                                                            |
| [W-10](W-10.md) | Medium   | WebAuthn → secp256k1 path is fragile                                  | 🟧 WebAuthn fallback shipped + assertion verifier wired to challenge endpoint (`/api/council/vote/challenge`, DECISION-008); native libykcs11 helper still deferred to M3-M4                                                         |
| [W-11](W-11.md) | Medium   | Hyperledger Fabric single-peer is theatre                             | 🟩 Postgres hash chain ships in MVP (`packages/audit-chain`); Fabric scaffolded for P2 (`chaincode/audit-witness`, `apps/worker-fabric-bridge`)                                                                                      |
| [W-12](W-12.md) | High     | Vault Shamir storage on YubiKey challenge-response slot mis-specified | 🟩 age-plugin-yubikey wired (`infra/host-bootstrap/02-yubikey-enrol.sh`, `03-vault-shamir-init.sh`, `packages/security/src/shamir.ts`)                                                                                               |
| [W-13](W-13.md) | Medium   | Tor-exit fingerprinting risk unaddressed                              | 🟩 layered egress (`packages/adapters/src/proxy.ts`) + runtime rate-limit + robots enforcement (`rate-limit.ts`, `robots.ts`, DECISION-008)                                                                                          |
| [W-14](W-14.md) | High     | Anti-hallucination L1-L12 not testable                                | 🟩 corpus at 224 rows (`packages/llm/__tests__/synthetic-hallucinations.jsonl`) — exceeds 200-row target; 12-layer guards live; L5 implemented; L8/L9/L10/L12 worker-level rows seeded. Per-pattern expansion can continue post-MVP. |
| [W-15](W-15.md) | High     | Defamation exposure on /verify                                        | 🟩 code surface verified entity-name-free (`apps/dashboard/src/lib/verify.server.ts`); operator-only `/api/findings/[id]` now has belt-and-braces role check                                                                         |
| [W-16](W-16.md) | High     | Calibration seed chicken-and-egg                                      | ⬛ deferred to M2 exit per spec; calibration tables ready (`calibration.entry`, `calibration.report`)                                                                                                                                |
| [W-17](W-17.md) | High     | Backup architect specced but never named                              | 🟦 institutional (architect names + retainer)                                                                                                                                                                                        |
| [W-18](W-18.md) | Medium   | 24-week timeline doesn't budget customs delay                         | 🟩 26/30-week re-baseline committed                                                                                                                                                                                                  |
| [W-19](W-19.md) | Medium   | No automated adapter self-healing                                     | 🟩 `apps/worker-adapter-repair` (prompts.ts + shadow-test.ts + DB tables `source.adapter_repair_proposal/shadow_log`)                                                                                                                |
| [W-20](W-20.md) | Medium   | No git/repo strategy documented                                       | 🟩 OPERATIONS.md                                                                                                                                                                                                                     |
| [W-21](W-21.md) | Medium   | Documentation pack not version-controlled                             | 🟩 markdown source-of-truth committed                                                                                                                                                                                                |
| [W-22](W-22.md) | Medium   | No Cameroon-specific threat model                                     | 🟩 THREAT-MODEL-CMR.md                                                                                                                                                                                                               |
| [W-23](W-23.md) | High     | No ANTIC declaration                                                  | 🟦 institutional (counsel engagement)                                                                                                                                                                                                |
| [W-24](W-24.md) | Medium   | GDPR audit budgeted but mostly inapplicable                           | 🟦 institutional (budget reallocation)                                                                                                                                                                                               |
| [W-25](W-25.md) | High     | CONAC delivery format asserted not negotiated                         | 🟩 format-adapter layer in code (`apps/worker-conac-sftp/src/format-adapter.ts`, `dossier.format_adapter_version`); engagement-letter negotiation 🟦 institutional                                                                   |
| [W-26](W-26.md) | Medium   | No formal Phase-0 dry-run sign-off                                    | 🟩 DRY-RUN-DECISION.md `Status: GO`                                                                                                                                                                                                  |
| [W-27](W-27.md) | Low      | Decision log not CI-enforced                                          | 🟩 `scripts/check-decisions.ts` + phase-gate.yml integration                                                                                                                                                                         |

## Severity tally

- **Critical**: 1 (W-07 — resolved)
- **High**: 12
- **Medium**: 12
- **Low**: 2

## Status tally (2026-05-17 reconciliation; T1–T11 sweep of TODO.md)

- 🟩 committed: 19 (was 18; W-14 graduated 2026-05-17 — corpus at 224 rows exceeds 200-row target)
- 🟧 in progress: 1 (W-10 native libykcs11 helper deferred M3-M4; WebAuthn fallback is the Phase-1 ship target)
- 🟦 institutional gate: 5 (W-08, W-17, W-23, W-24, plus institutional half of W-25)
- ⬛ deferred by spec: 1 (W-16 — M2 exit)
- 🟨 proposed: 0
- 🟥 unresolved: 0

5 weaknesses (W-08, W-17, W-23, W-24, W-25-institutional-half) are gated on
architect or counsel external action and cannot be closed by code alone.

DECISION-008 added 7 tiers of production-hardening on top of the W-NN status
above (fail-closed gates, config hygiene, adapter base hardening, source-
count reconciliation, WebAuthn verifier, civil-society portal, critical-
path tests). See `docs/decisions/log.md` for the full diff inventory.
