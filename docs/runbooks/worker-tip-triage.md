# Runbook — worker-tip-triage

> Decrypts a tip via 3-of-5 council Shamir shares; paraphrases via
> SafeLlmRouter; routes to operator triage queue. Block-B B.4
> migrated to SafeLlmRouter (commit `10dac28`).
>
> **Service:** [`apps/worker-tip-triage/`](../../apps/worker-tip-triage/) — LLM-using; council-Shamir-decrypt sensitive path.

---

## Description

### 🇫🇷

Triage des tips citoyens. Pour chaque tip à décrypter, reçoit 3
parts Shamir des membres du conseil (3-of-5 quorum SRD §28.4),
reconstruit la clé privée operator-team, déchiffre via libsodium
sealed box. Paraphrase + classifie via SafeLlmRouter
(`promptName: 'tip-triage.paraphrase'`) avec règles PII-stripping.
Met à jour `tip.disposition`.

### 🇬🇧

Citizen-tip triage. For each tip to decrypt, receives 3 Shamir
shares from council members (3-of-5 quorum SRD §28.4), reconstructs
the operator-team private key, decrypts via libsodium sealed box.
Paraphrases + classifies via SafeLlmRouter (`promptName:
'tip-triage.paraphrase'`) with PII-stripping rules. Updates
`tip.disposition`.

---

## Boot sequence

1. `LlmRouter` + `SafeLlmRouter` (DECISION-011).
2. `Safety.adversarialPromptsRegistered()` check.
3. `CallRecordRepo` wired as sink.
4. `VaultClient.connect()` — operator-team public key.
5. Consumer-group on `vigil:tip:triage`.

---

## Health-check signals

| Metric                                                       | Healthy | Unhealthy → action |
| ------------------------------------------------------------ | ------- | ------------------ |
| `up{instance=~".*worker-tip-triage.*"}`                      | `1`     | `0` > 2 min → P1   |
| `vigil_worker_last_tick_seconds{worker="worker-tip-triage"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                           | SLO target | Investigate-worthy    |
| -------------------------------- | ---------- | --------------------- |
| Decrypt + paraphrase latency p99 | < 30 s     | > 60 s → LLM slow     |
| Schema-validation rejection rate | < 1 %      | > 10 % → prompt drift |

---

## Common failures

| Symptom                        | Likely cause                                         | Mitigation                                                                                                    |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `shamir-combine-failed` log    | one of the 3 shares is malformed                     | Operator UI re-collects shares; council members re-submit.                                                    |
| `tip-decrypt-failed`           | reconstructed key doesn't match the tip's encryption | Audit operator-team public key; possibly key rotation broke historical tips (use prior key for back-decrypt). |
| `paraphrase-failed` retry loop | LLM error                                            | See [worker-counter-evidence.md R3](./worker-counter-evidence.md) common failures.                            |

---

## R1 — Routine deploy

```sh
docker compose pull worker-tip-triage
docker compose up -d worker-tip-triage
```

## R2 — Restore from backup

Reads `tip.tip` + writes paraphrase notes back. Encrypted at rest
via the same operator-team key. No local state.

## R3 — Credential rotation

`anthropic/api_key` rotation per
[worker-counter-evidence.md R3](./worker-counter-evidence.md).

`TIP_OPERATOR_TEAM_PUBKEY` (operator-team libsodium key pair)
rotation is separate — quarterly per HSK-v1 §6.4. Procedure:

```sh
# 1. Generate new keypair (operator-team ceremony, all 5 council members present)
libsodium-cli keygen > /tmp/tip-team-newkey.json

# 2. Split private key into 5-of-3 Shamir shares (one per pillar)
# (Done via the council UI / age-plugin-yubikey).

# 3. Update Vault
vault kv put secret/tip-portal operator_team_public_key=<new-pub>

# 4. Update env so dashboard /api/tip/public-key returns new pub
docker compose restart dashboard worker-tip-triage

# 5. Verify
curl http://dashboard/api/tip/public-key  # → new pubkey
```

Old tips (encrypted with prior pub) remain decryptable via the
prior private key shares; archival.

## R5 — Incident response

| Severity | Trigger                            | Action                                                      |
| -------- | ---------------------------------- | ----------------------------------------------------------- |
| **P1**   | Worker down + tip queue            | Page on-call. Tips can't be triaged; operator review halts. |
| **P1**   | Anthropic rate-limit on tip-triage | Page on-call. Tier-1 Bedrock failover should activate.      |
| **P2**   | Schema rejection rate > 10 %       | Audit prompt-version drift in registry.                     |
| **P3**   | Single tip stuck `IN_TRIAGE`       | Operator triages manually; investigate underlying cause.    |

## R4 — Council pillar rotation

R4 affects this worker only via the operator-team Shamir share
holders. When a pillar rotates ([R4-council-rotation.md](./R4-council-rotation.md)),
the new pillar receives a fresh Shamir share of the operator-team
key. No worker code change.

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-tip-triage/src/index.ts`](../../apps/worker-tip-triage/src/index.ts) — handler + SafeLlmRouter call.
- [`apps/worker-tip-triage/src/prompts.ts`](../../apps/worker-tip-triage/src/prompts.ts) — registered prompt.
- [`apps/worker-tip-triage/__tests__/safe-call.test.ts`](../../apps/worker-tip-triage/__tests__/safe-call.test.ts) — Block-B A2 doctrine-surface regression.
- **SRD §28.4** — 3-of-5 council quorum decryption.
- **DECISION-011** — AI-Safety doctrine.
- **DECISION-016** — tip retention guarantee.
- **HSK-v1 §6.4** — operator-team key rotation.
- **Block-B A2** — SafeLlmRouter migration (commit `10dac28`).
