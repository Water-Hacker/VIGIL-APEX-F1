# Runbook — keycloak (vigil-keycloak)

> Infra-plane service. Docker-compose-managed. Provides OIDC SSO
> for the operator / council surfaces of the dashboard.
>
> **Service:** docker-compose service `vigil-keycloak`. NOT
> internet-facing; sits behind the dashboard reverse proxy.

---

## Description

### 🇫🇷

Fournisseur OIDC pour l'authentification SSO des opérateurs et du
conseil. WebAuthn challenge / assertion par YubiKey via
`@simplewebauthn/server`. Le challenge réside dans Keycloak ;
l'assertion vérifiée est consommée par le dashboard pour ouvrir
une session.

### 🇬🇧

OIDC provider for operator and council SSO. WebAuthn challenge /
assertion via YubiKey through `@simplewebauthn/server`. Challenge
lives in Keycloak; verified assertion is consumed by the dashboard
to open a session.

---

## Boot sequence

1. Docker compose pulls `quay.io/keycloak/keycloak:<pinned>`.
2. Keycloak attaches to a dedicated postgres database
   (`keycloak` schema, separate from `vigil`).
3. Realm `vigil-apex` imported on first boot from
   `infra/docker/keycloak/realm-export.json`.
4. Dashboard reads `KEYCLOAK_URL` + `KEYCLOAK_REALM` +
   `KEYCLOAK_CLIENT_ID` + `KEYCLOAK_CLIENT_SECRET_FILE`.

---

## Health-check signals

| Metric                        | Healthy | Unhealthy → action                    |
| ----------------------------- | ------- | ------------------------------------- |
| HTTP `/health/ready`          | 200     | non-200 > 60 s → P1                   |
| Keycloak DB connection (logs) | OK      | failures → check postgres healthcheck |

## SLO signals

| Metric                                  | SLO target | Investigate-worthy                        |
| --------------------------------------- | ---------- | ----------------------------------------- |
| Login success rate (operator + council) | > 99 %     | < 95 % → triage WebAuthn / browser issues |
| Token-refresh latency p99               | < 500 ms   | > 2 s → keycloak slow                     |
| Disk usage on `keycloak_data`           | < 60 %     | > 80 % → archive old audit logs           |

---

## Common failures

| Symptom                                   | Likely cause                                     | Mitigation                                                                 |
| ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Operators see "auth provider unavailable" | keycloak down                                    | `docker compose logs vigil-keycloak --tail=200`; restart.                  |
| WebAuthn assertion always fails           | challenge TTL too short OR realm config drift    | Inspect realm export vs live; re-import if drift.                          |
| Council member can't log in (only some)   | WebAuthn credential not registered for that user | Operator triage via Keycloak admin UI; re-register the YubiKey.            |
| Slow login                                | postgres backend (keycloak schema) lag           | Check shared postgres health; the keycloak schema is on the same instance. |

---

## R1 — Routine deploy

```sh
docker compose pull vigil-keycloak
docker compose up -d vigil-keycloak
```

Verify within 60 s:

- `curl -s http://vigil-keycloak:8080/health/ready` → 200.
- Test login as an operator account.

---

## R2 — Restore from backup

Per SRD §31.2.

Keycloak's data lives in postgres (`keycloak` schema). Restore
follows the postgres restore procedure ([postgres.md R2](./postgres.md)).
After postgres is back, restart keycloak; realm + users + WebAuthn
credentials all come back from the DB.

If the realm-export drifted (e.g., admin made changes via UI not
captured in the export), the post-restore state is what postgres
holds — the export is for first-boot bootstrap only.

---

## R3 — Credential rotation

Two rotatable credentials:

**OIDC client secret** (consumed by the dashboard):

```sh
NEW_SECRET="$(openssl rand -hex 32)"

# 1. Rotate via Keycloak admin (UI or kc.sh CLI)
docker compose exec vigil-keycloak /opt/keycloak/bin/kcadm.sh \
  update clients/<client-uuid>/client-secret \
  -r vigil-apex -s value="$NEW_SECRET"

# 2. Update Vault
vault kv put secret/keycloak client_secret="$NEW_SECRET"

# 3. Restart dashboard so it re-reads KEYCLOAK_CLIENT_SECRET_FILE
docker compose restart dashboard
```

**Keycloak admin password** (architect-only):

```sh
NEW_PWD="$(openssl rand -base64 32)"

# Reset via kcadm
docker compose exec vigil-keycloak /opt/keycloak/bin/kcadm.sh \
  set-password -r master --username admin --new-password "$NEW_PWD"

# Update Vault
vault kv put secret/keycloak admin_password="$NEW_PWD"
```

Quarterly per HSK-v1 §6.

---

## R5 — Incident response

| Severity | Trigger                                                | Action                                                                             |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **P1**   | Keycloak down for > 5 min during business hours        | Page on-call. Operators / council can't log in; halts review workflow.             |
| **P1**   | Council WebAuthn assertion failures (multiple members) | Page architect. Possible realm-config drift; triage urgently.                      |
| **P2**   | Single user can't log in                               | Operator triage; re-register WebAuthn credential or reset password as appropriate. |
| **P3**   | Token-refresh latency rising                           | Investigate keycloak's postgres-backend latency.                                   |

---

## R4 — Council pillar rotation

Keycloak is touched indirectly: when a pillar holder changes (R4),
the new pillar's WebAuthn credential is registered in Keycloak via
the dashboard council admin surface. Procedure in
[R4-council-rotation.md](./R4-council-rotation.md) §Procedure step 4.

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). Keycloak
restore depends on postgres restore; no separate timing budget.

---

## Cross-references

### Code

- [`apps/dashboard/src/lib/auth/`](../../apps/dashboard/src/lib/) — OIDC client + WebAuthn challenge/assertion verification.
- [`infra/docker/keycloak/realm-export.json`](../../infra/docker/keycloak/) — realm bootstrap.

### Binding spec

- **SRD §17** — auth surface principles.
- **SRD §28.1** — council vote-signing flow.
- **DECISION-008 C5b** — WebAuthn fallback live; native PKCS#11 deferred to M3-M4.
- **HSK-v1 §6** — credential rotation cadence.
