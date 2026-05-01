# Runbook — worker-conac-sftp

> CONAC + Cour des Comptes + MINFI + ANIF dossier delivery via
> SFTP. Refuses to ship if signer manifest incomplete OR delivery
> target unprovisioned.
>
> **Service:** [`apps/worker-conac-sftp/`](../../apps/worker-conac-sftp/) — SSH-key-protected SFTP delivery; LLM-using on the optional narrative path.

---

## Description

### 🇫🇷

Livraison SFTP des dossiers escaladés aux corps destinataires
(CONAC primaire, et selon le finding : Cour des Comptes, MINFI,
ANIF). Refuse fail-closed si `GPG_FINGERPRINT` ou `SIGNER_*` est
PLACEHOLDER (Block-A A9 / signer-manifest discipline). Refuse
si le `target.host` est PLACEHOLDER (re-queue 24 h pour livraison
ultérieure post-MOU).

### 🇬🇧

SFTP delivery of escalated dossiers to recipient bodies (CONAC
primary, plus per-finding: Cour des Comptes, MINFI, ANIF). Fails
closed if `GPG_FINGERPRINT` or `SIGNER_*` is PLACEHOLDER (Block-A
A9 / signer-manifest discipline). Refuses if `target.host` is
PLACEHOLDER (re-queues 24 h for later delivery post-MOU).

---

## Boot sequence

1. `requireGpgFingerprint()` — refuses PLACEHOLDER + non-40-hex.
2. `assertCriticalTargetsConfigured()` — verifies recipient body
   targets resolve.
3. SSH private key loaded from Vault (`secret/conac-sftp/private_key`).
4. Consumer-group on `vigil:dossier:deliver`.

---

## Health-check signals

| Metric                                                       | Healthy | Unhealthy → action |
| ------------------------------------------------------------ | ------- | ------------------ |
| `up{instance=~".*worker-conac-sftp.*"}`                      | `1`     | `0` > 2 min → P0   |
| `vigil_worker_last_tick_seconds{worker="worker-conac-sftp"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                                | SLO target | Investigate-worthy                            |
| ----------------------------------------------------- | ---------- | --------------------------------------------- |
| Delivery latency post-vote                            | < 24 h     | > 24 h → SLA breach (CONAC engagement letter) |
| `vigil_dossier_delivery_total{outcome="failed"}` rate | 0          | > 0 → page on-call                            |

---

## Common failures

| Symptom                                        | Likely cause                         | Mitigation                                                              |
| ---------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `GPG_FINGERPRINT is PLACEHOLDER`               | env not configured                   | Block-A A9: signer manifest required pre-flight; configure before boot. |
| `target.host` PLACEHOLDER for a recipient body | MOU pending for that body            | Re-queue 24 h; expected behaviour pre-MOU.                              |
| SSH handshake fails                            | known_hosts drift OR SSH key expired | Verify `CONAC_SFTP_HOSTKEY_FINGERPRINT` matches; rotate SSH key per R3. |
| Dossier hash mismatch on delivery              | re-render produced different bytes   | Page architect; investigate AUDIT-063 byte-identity regression.         |

---

## R1 — Routine deploy

```sh
docker compose pull worker-conac-sftp
docker compose up -d worker-conac-sftp
```

Pre-MOU recipient bodies: dossiers re-queue 24 h.

## R2 — Restore from backup

Reads dossier deliverables from Postgres + IPFS; no local state.
SSH key in Vault.

## R3 — Credential rotation

**Two credentials to rotate:**

1. **SSH private key** for SFTP authentication (per recipient body):

   ```sh
   # 1. Generate new keypair
   ssh-keygen -t ed25519 -f /tmp/new-sftp-key -C "vigil-apex-conac"
   # 2. Coordinate with CONAC ops to install pubkey
   # 3. Update Vault
   vault kv put secret/conac-sftp private_key=@/tmp/new-sftp-key
   # 4. Restart worker
   docker compose restart worker-conac-sftp
   # 5. Verify next delivery succeeds
   ```

2. **GPG signing key** (`GPG_FINGERPRINT`):

   The GPG key is on the architect's primary YubiKey (HSK-v1 §5.6).
   Rotation is a YubiKey ceremony — generate new key on-card,
   export pubkey to recipient bodies, update env. See HSK-v1 §6.

`anthropic/api_key` rotation: only if the optional LLM-narrative
path is enabled; same procedure as
[worker-counter-evidence.md R3](./worker-counter-evidence.md).

## R5 — Incident response

| Severity | Trigger                                        | Action                                                                |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| **P0**   | Dossier delivery SLA breach (post-vote > 24 h) | Page architect 24/7. CONAC engagement letter SLA at risk.             |
| **P0**   | SSH handshake fails for ALL recipient bodies   | Page architect. Possibly compromised key OR known_hosts manipulation. |
| **P1**   | One recipient body's deliveries failing        | Page on-call. Coordinate with that body's IT contact.                 |
| **P2**   | Worker idle (queue empty for > 24 h)           | Verify no upstream block (worker-dossier health).                     |
| **P3**   | Manifest validation rejection                  | Inspect; possibly format-adapter drift.                               |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). The
post-restore SFTP handshake is a critical SLA datapoint.

---

## Cross-references

- [`apps/worker-conac-sftp/src/index.ts`](../../apps/worker-conac-sftp/src/index.ts) — handler + signer-manifest guards.
- [`apps/worker-conac-sftp/src/delivery-targets.ts`](../../apps/worker-conac-sftp/src/delivery-targets.ts) — per-body target resolution.
- [`apps/worker-conac-sftp/src/format-adapter.ts`](../../apps/worker-conac-sftp/src/format-adapter.ts) — manifest builder.
- **SRD §25** — bilingual dossier delivery.
- **DECISION-010** — per-body dossier delivery.
- **AUDIT-063** — byte-identical PDF.
- **HSK-v1 §5.6** — GPG-on-YubiKey rotation.
- **HSK-v1 §6** — credential rotation cadence.
