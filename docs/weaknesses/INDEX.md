# Weakness Tracker — Index

This is the live status of the 27 weaknesses identified during assimilation
(2026-04-28). Each weakness has its own file with full text. The index gives
status at a glance.

**Status legend**: 🟥 unresolved · 🟧 in progress · 🟨 fix proposed · 🟩 fix committed · ⬛ deferred

| ID | Severity | Title | Status |
|---|---|---|---|
| [W-01](W-01.md) | High | Host OS conflict (Ubuntu+LUKS2 vs Windows+BitLocker) | 🟩 fix committed in TRUTH |
| [W-02](W-02.md) | Medium | NAS model & RAID drift | 🟩 |
| [W-03](W-03.md) | High | YubiKey count drift (8 vs 5+3 vs 2) | 🟩 |
| [W-04](W-04.md) | Low | Pattern count drift (40+ vs 43) | 🟩 |
| [W-05](W-05.md) | Medium | Source count drift (22 vs 26) | 🟩 |
| [W-06](W-06.md) | High | PPTX vs SRD/MVP — no architectural bridge | 🟨 fix proposed in ROADMAP |
| [W-07](W-07.md) | Critical | Build Companion v1 missing from working dir | 🟩 located + extracted |
| [W-08](W-08.md) | High | OpenPGP signing key has no break-glass | 🟨 deep-cold proposed |
| [W-09](W-09.md) | High | Tip portal is Tor-friendly not Tor-native | 🟨 .onion v3 proposed |
| [W-10](W-10.md) | Medium | WebAuthn → secp256k1 path is fragile | 🟨 native helper proposed |
| [W-11](W-11.md) | Medium | Hyperledger Fabric single-peer is theatre | 🟨 deferred to Phase 2 |
| [W-12](W-12.md) | High | Vault Shamir storage on YubiKey challenge-response slot mis-specified | 🟨 age-plugin-yubikey proposed |
| [W-13](W-13.md) | Medium | Tor-exit fingerprinting risk unaddressed | 🟨 layered egress policy proposed |
| [W-14](W-14.md) | High | Anti-hallucination L1-L12 not testable | 🟨 synthetic corpus proposed |
| [W-15](W-15.md) | High | Defamation exposure on /verify | 🟨 audit-root-only proposed |
| [W-16](W-16.md) | High | Calibration seed chicken-and-egg | 🟨 60-day shadow mode proposed |
| [W-17](W-17.md) | High | Backup architect specced but never named | 🟧 in progress |
| [W-18](W-18.md) | Medium | 24-week timeline doesn't budget customs delay | 🟩 26/30-week re-baseline committed |
| [W-19](W-19.md) | Medium | No automated adapter self-healing | 🟨 worker-adapter-repair proposed |
| [W-20](W-20.md) | Medium | No git/repo strategy documented | 🟩 fixed in OPERATIONS.md |
| [W-21](W-21.md) | Medium | Documentation pack not version-controlled | 🟩 markdown source-of-truth committed |
| [W-22](W-22.md) | Medium | No Cameroon-specific threat model | 🟩 fixed in THREAT-MODEL-CMR.md |
| [W-23](W-23.md) | High | No ANTIC declaration | 🟧 counsel engagement pending |
| [W-24](W-24.md) | Medium | GDPR audit budgeted but mostly inapplicable | 🟨 reallocation proposed |
| [W-25](W-25.md) | High | CONAC delivery format asserted not negotiated | 🟨 format-adapter layer proposed |
| [W-26](W-26.md) | Medium | No formal Phase-0 dry-run sign-off | 🟩 DRY-RUN-DECISION.md template |
| [W-27](W-27.md) | Low | Decision log not CI-enforced | 🟨 lint planned |

## Severity tally

- **Critical**: 1 (W-07 — resolved)
- **High**: 11
- **Medium**: 12
- **Low**: 2

## Status tally

- 🟩 committed: 9
- 🟨 proposed: 13
- 🟧 in progress: 2
- 🟥 unresolved: 0
- ⬛ deferred: 0

13 weaknesses are blocked on architect institutional or counsel work
(W-08 deep-cold, W-15 counsel, W-17 backup architect, W-23 ANTIC, W-25 CONAC negotiation, etc.).
The remaining proposed fixes ship with code in Phase 0+.
