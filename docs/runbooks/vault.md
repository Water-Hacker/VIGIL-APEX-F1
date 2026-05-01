# Runbook — vault (vigil-vault)

> Infra-plane service. Docker-compose-managed. HashiCorp Vault.
> Centre of the secret-management estate; unsealed via 3-of-5
> Shamir per SRD §17.6 + EXEC §17.
>
> **Service:** docker-compose service `vigil-vault`. Holds every
> service password, every API key, every Polygon-signer recovery
> material reference. Loss-of-availability is a P0; loss-of-secrets
> is the architect's recovery-from-Shamir-shares scenario.

---

## Description

### 🇫🇷

Centre de gestion des secrets. 3-of-5 Shamir pour le déverrouillage
au démarrage (5 piliers du conseil ; 3 obligatoires pour reconstruire
la clé maîtresse). Stocke les mots de passe de service, les clés
API, les références aux matériaux de récupération du signataire
Polygon. Une indisponibilité Vault rend l'écosystème entier
inopérant — chaque worker lit ses secrets au démarrage.

### 🇬🇧

Secret-management centre. 3-of-5 Shamir for boot unseal (5 council
pillars; 3 required to reconstruct the master key). Holds service
passwords, API keys, references to Polygon-signer recovery
material. Vault unavailability renders the entire ecosystem
inoperable — every worker reads its secrets on boot.

---

## Boot sequence

1. Docker compose pulls `hashicorp/vault:<pinned>`.
2. Vault starts in **sealed** state (default, by design).
3. **Operator-initiated unseal** required: 3 of 5 council Shamir
   shares submitted via `vault operator unseal` (one share per
   council member; PIV-resident on each pillar's YubiKey, retrieved
   via `age-plugin-yubikey`). See SRD §17.6.2.
4. Once unsealed, workers connect via `VAULT_ADDR`
   (`http://vigil-vault:8200`) using AppRole auth (per-service
   role IDs + secret IDs).
5. Each worker reads its scoped secrets via `vault.read(...)`.

---

## Health-check signals

| Metric                                 | Healthy  | Unhealthy → action                                       |
| -------------------------------------- | -------- | -------------------------------------------------------- |
| `vault status` `Sealed: false`         | unsealed | sealed > 60 s after expected unseal → P0                 |
| `vault status` `Initialized: true`     | true     | false → bootstrap incomplete (Phase 0 step missing)      |
| Docker healthcheck                     | OK       | failing > 30 s → P0                                      |
| `vigil_vault_token_renew_failed_total` | flat     | rising → workers losing token renewal (will fail closed) |

## SLO signals

| Metric                             | SLO target | Investigate-worthy                                                  |
| ---------------------------------- | ---------- | ------------------------------------------------------------------- |
| Vault token TTL ratio (per-worker) | > 50 %     | < 25 % → renewal lag                                                |
| Audit log volume                   | < 100 MB/d | > 500 MB/d → review noisy access patterns                           |
| Sealed-time per restart            | < 5 min    | > 10 min → operator unseal slow (3 council members slow to respond) |

---

## Common failures

| Symptom                                          | Likely cause                                   | Mitigation                                                                              |
| ------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Workers logging `vault: connection refused`      | vigil-vault sealed or down                     | `vault status`. If sealed: run unseal ceremony (3 council Shamir shares).               |
| `vault status` shows `Sealed: true` post-restart | host reboot without unseal automation          | Operator runs the 3-share unseal ceremony per SRD §17.6.2.                              |
| Token renewal failures (per-worker)              | Vault recently restarted; token leases expired | Workers re-acquire via AppRole on next boot/restart. Affected workers may need restart. |
| Shamir share holder unavailable mid-rotation     | one council member unreachable in window       | Use the 4th share if available; otherwise wait or invoke DR procedure (SRD §17.6.3).    |

---

## R1 — Routine deploy

Vault deploys are **architect-only**. Procedure:

```sh
# 1. Backup current vault data first
docker compose exec vigil-vault vault operator raft snapshot save /tmp/vault-pre-deploy.snap
docker cp vigil-vault:/tmp/vault-pre-deploy.snap /tmp/

# 2. Bump image
docker compose pull vigil-vault
docker compose up -d vigil-vault

# 3. Container restarts in sealed state. Run unseal.
vault operator unseal <share-1>
vault operator unseal <share-2>
vault operator unseal <share-3>

# 4. Verify
vault status
vault read secret/postgres
```

The unseal ceremony is the constraint: 3 council members must be
available within ~30 min. Schedule deploys accordingly.

---

## R2 — Restore from backup

Per SRD §31.2 + SRD §17.6.3 (disaster unseal).

Vault data is in the raft store + the Shamir shares (held by
council pillars on YubiKeys). Recovery scenarios:

1. **Host loss with NAS-replica intact:** restore the raft snapshot
   from NAS, redeploy vigil-vault, run the standard unseal ceremony.
2. **Host loss + NAS-replica loss (catastrophic):** Phase-1 doctrine
   — see HSK-v1 §5.6 deep-cold backup. The architect's deep-cold
   YubiKey (off-jurisdiction safe-deposit box; W-08 fix) holds an
   identical OpenPGP master + AppRole bootstrap material. Recovery
   procedure in EXEC §17.5.
3. **Council pillar holding a Shamir share unavailable:** if 3 of
   the remaining 4 are reachable, proceed with normal unseal. If
   only 2 are reachable, escalate to architect; deep-cold backup
   may be required.

---

## R3 — Credential rotation (Shamir share rotation)

This is **NOT a routine credential rotation** — it's a 5-pillar
council ceremony per EXEC §17.

When to rotate:

- A pillar holder changes (R4 council rotation).
- Annual ceremony per HSK-v1 §6.3 (if no pillar change occurred in the year).
- Emergency: a pillar's YubiKey is lost / compromised.

Procedure (high-level; detailed steps in EXEC §17.4):

1. Architect schedules the ceremony with all 5 pillars + the
   backup architect.
2. Generate new Shamir shares: `vault operator generate-root` +
   `vault operator rekey -init -key-shares=5 -key-threshold=3`.
3. Each of the 5 pillars submits an existing share to the rekey
   operation; receives a new share.
4. New shares stored on each pillar's YubiKey via
   `age-plugin-yubikey` (PIV slot 9d per HSK-v1 §4.5).
5. Old shares destroyed (overwrite the YubiKey slot or wipe the
   token-paper backup if any).
6. Architect verifies 3 of 5 new shares unseal successfully.
7. Audit row `vault.rekey_completed` written via halt-on-failure
   audit emit (HIGH_SIGNIFICANCE).

If a pillar is unavailable, the rekey can use the backup
architect's recovery share (HSK-v1 §5.4); but only with the
architect's signed authorisation.

---

## R5 — Incident response

| Severity | Trigger                                                             | Action                                                                                          |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **P0**   | Vault sealed AND no unseal ceremony in progress                     | Page architect 24/7. Schedule unseal ceremony; every worker is offline until Vault is unsealed. |
| **P0**   | Vault unreachable but unsealed (network partition, container crash) | Page architect. Restart container; if persistent, fall back to NAS-replica + unseal ceremony.   |
| **P0**   | Suspected Shamir share compromise (pillar reports YubiKey lost)     | Page architect. Initiate emergency rekey ceremony per R3. Halt non-critical workers.            |
| **P1**   | Vault audit log shows unexpected access pattern                     | Page architect. Review audit log; possible token compromise.                                    |
| **P2**   | Token renewal failures sustained for one worker                     | Restart that worker (re-acquires AppRole token).                                                |
| **P3**   | Audit log volume growing                                            | Operator review; archive + truncate per cadence.                                                |

---

## R4 — Council pillar rotation

**Vault is the centre of R4** because rotating a pillar holder
triggers a Shamir share rotation. See [R4-council-rotation.md](./R4-council-rotation.md)
for the procedural shape; the cryptographic half (this section's R3)
is the canonical reference for the rekey procedure.

## R6 — Monthly DR exercise

Vault is included. The DR rehearsal exercises the unseal ceremony
itself — simulating a host loss + restore from NAS + 3-share
unseal under time pressure. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

### Code

- [`packages/security/src/vault.ts`](../../packages/security/src/vault.ts) — Vault client wrapper, AppRole bootstrap.
- [`infra/vault-policies/`](../../infra/vault-policies/) — per-service ACL policies.
- [`infra/host-bootstrap/`](../../infra/host-bootstrap/) — bootstrap scripts including 06-vault-policies.sh.

### Binding spec

- **SRD §17.5** — LUKS unlock at boot.
- **SRD §17.6** — Vault Shamir unseal flow.
- **SRD §17.6.1** — Vault initialisation (one-time, M0c week 1).
- **SRD §17.6.2** — Routine unseal flow (every reboot).
- **SRD §17.6.3** — Disaster unseal (architect unavailable).
- **SRD §31.2** — R2 restore.
- **EXEC §17** — pillar rekey ceremony.
- **HSK-v1 §4.5** — PIV slot 9d allocation for Shamir.
- **HSK-v1 §5.6** — deep-cold backup.
- **HSK-v1 §6.3** — annual rotation cadence.
