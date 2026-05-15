# Runbook — Secret rotation

> Operational policy + per-secret-type procedures for rotating
> credentials held in Vault. Captures the **restart-on-rotate** posture
> ratified in orientation §7 Q4 (mode 9.2 closure).
>
> **Audience:** the on-call engineer running a scheduled secret
> rotation or responding to a credential-compromise alert.
>
> **Authority:** the architect schedules the rotation cadence; this
> document is the canonical procedure for executing it.

---

## The contract

VIGIL APEX workers read every credential from a file mounted under
`/run/secrets/` (compose) or `/var/run/secrets/external-secrets/`
(k3s, projected by ExternalSecretsOperator from Vault). The pattern is:

```
                          ┌──────────────────────────┐
   Vault KV/Database     │  ExternalSecretsOperator  │   k3s mount
   path                  │  refreshRate = 1h          │  → /var/run/secrets/.../redis_password
─────────────────────────►                            ├──────────────────────────────► worker pod
                          │  (or Docker secret in     │
                          │   compose, manual swap)   │   compose mount
                          └──────────────────────────┘   → /run/secrets/redis_password
```

**The worker reads the file once at process start.** There is no
in-process file watcher. A rotated password lands in the file
within the ESO refresh window (~60–90 s in k3s; manual swap in
compose), but the running worker continues to use the OLD password
until restarted.

This posture is **deliberate**. Per orientation §7 Q4:

> Hot-reload via Vault Agent sidecar is genuinely better operationally
> but adds a sidecar to every workload. Recommend: tests +
> restart-on-rotate for now; revisit during M5 prep.

The contract is pinned by:

- The function header on `loadRedisPassword`
  (`packages/queue/src/client.ts`).
- The unit test `packages/queue/__tests__/secret-rotation.test.ts`.
- The DB equivalent in `packages/db-postgres/src/client.ts` inlines the
  same pattern (no extracted function; the same test pattern would
  apply if/when extracted).

If a future closure adopts hot-reload (orientation §7 Q4 revisit), the
test + the function header + this runbook must all be updated together.

---

## Rotation cadence (the architect schedules)

| Secret               | Authority                            | Default cadence | Trigger for emergency rotation                                                |
| -------------------- | ------------------------------------ | --------------- | ----------------------------------------------------------------------------- |
| Vault AppRole tokens | Vault auto-issues; AppRole TTL = 1 h | hourly (auto)   | Never manually rotate; Vault handles                                          |
| Redis password       | architect-rotates via Vault KV       | quarterly       | Compromise alert; ex-operator off-boarding                                    |
| Postgres password    | architect-rotates via Vault KV       | quarterly       | Compromise alert; ex-operator off-boarding                                    |
| Turnstile secret     | Cloudflare-rotates                   | annual          | Turnstile token-replay alert; ex-operator who had Cloudflare dashboard access |
| Polygon signer key   | YubiKey — never leaves device        | never           | YubiKey loss / compromise → key-replacement ceremony (R10)                    |
| Council Shamir share | YubiKey — never leaves device        | never           | Council-member rotation (R4) issues a new share                               |
| TLS cert (Caddy)     | cert-manager / Let's Encrypt         | every 60 days   | Auto via cert-manager; metric `certificate_expiry_days_remaining` < 14 fires  |
| Cosign signing key   | architect-rotates via Vault Transit  | annual          | Compromise alert; CI-runner compromise                                        |

Annual + quarterly rotations are scheduled in the architect's calendar
with 2-week lead time. The 2 weeks let counterparty systems (Vault
ESO, Cloudflare API, etc.) be pre-configured.

---

## Procedure — Redis / Postgres password (KV secret)

These two are identical in shape. Substitute the relevant Vault path +
secret-file mount.

### 1. Pre-rotation checks

```bash
# Verify Vault is healthy and ESO is syncing.
kubectl -n external-secrets get pods
kubectl -n vigil get externalsecret -o wide
# All ExternalSecret resources should show STATUS=SecretSynced and
# READY=True. If any show ERROR, debug ESO first — DO NOT rotate.

# Identify which workers will need to restart. Every pod that mounts
# the rotated secret. For redis_password:
kubectl -n vigil get pods -l 'redis-consumer in (true)' \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
```

### 2. Generate the new password

```bash
# 32-byte hex; matches the Vault-generated entropy. Stored ONLY in
# Vault — never written to operator disk.
NEW_PW=$(openssl rand -hex 32)
```

### 3. Set the new password on the SERVICE side

For Redis:

```bash
# Add the new password as a SECOND value. ACL SETUSER applies the
# UPDATE; the OLD password remains valid until step 6 retires it.
redis-cli -a "$OLD_PW" ACL SETUSER default \
  ">$NEW_PW"     # Adds the new password; old still works.
```

For Postgres:

```bash
# Add a NEW role with the new password. We do NOT change the password
# on the existing role mid-flight — that would invalidate every
# in-flight connection. Instead, the role transition is in step 6.
psql -U vigil_admin -c \
  "CREATE USER vigil_new WITH PASSWORD '$NEW_PW' IN ROLE vigil"
```

### 4. Push the new password to Vault

```bash
vault kv put vigil/redis password="$NEW_PW"
# OR for postgres:
vault kv put vigil/postgres password="$NEW_PW" user="vigil_new"
```

### 5. Wait for ESO to sync (or manually trigger)

```bash
# Auto-sync: refreshRate=1h is configured; you can wait up to 60 min.
# Manual trigger:
kubectl -n vigil annotate externalsecret redis-password \
  force-sync="$(date +%s)" --overwrite
# Watch the Kubernetes Secret resource update its data:
kubectl -n vigil get secret redis-password -o jsonpath='{.metadata.annotations}'
```

For compose: manually swap the Docker secret. Compose secrets are
not designed for hot rotation; the conventional path is to update
`compose.override.yml` and `docker compose up -d` the affected
services.

### 6. Restart the workers

This is the load-bearing step. Pods read the password ONCE at start;
restart picks up the new value.

```bash
# Rolling restart in k3s (Deployments only; StatefulSets restart in
# order, slower but safer for Redis itself).
kubectl -n vigil rollout restart deployment \
  worker-pattern worker-score worker-extractor worker-entity \
  worker-counter-evidence worker-document worker-dossier \
  worker-anchor worker-audit-watch worker-governance \
  worker-tip-triage worker-conac-sftp worker-minfi-api \
  worker-adapter-repair worker-fabric-bridge worker-federation-agent \
  worker-federation-receiver worker-image-forensics

# Watch each Deployment roll:
kubectl -n vigil rollout status deployment/worker-pattern --timeout=120s
# (repeat per Deployment OR script the loop)

# Confirm no pods are using the OLD password by checking auth-error
# metrics on the Redis side:
redis-cli INFO clients | grep -E 'connected_clients|maxclients'
# Older connections drain as pods cycle.
```

For compose:

```bash
# Compose: down + up the worker services.
docker compose -f infra/docker/docker-compose.yaml \
  up -d --force-recreate worker-pattern worker-score # …etc.
```

### 7. Retire the old password

After all pods have rolled (verified via `kubectl rollout status`):

```bash
# Redis: REMOVE the old password.
redis-cli -a "$NEW_PW" ACL SETUSER default \
  "<$OLD_PW"     # Removes the OLD password; only NEW now valid.

# Postgres: REVOKE login on the old role, DROP after 24 h grace.
psql -U vigil_admin -c "ALTER USER vigil WITH NOLOGIN;"
# After 24 h, if no audit alerts:
psql -U vigil_admin -c "DROP USER vigil;"
psql -U vigil_admin -c "ALTER USER vigil_new RENAME TO vigil;"
```

### 8. Audit log

```bash
# Every rotation produces an audit-chain row:
psql -U vigil_admin -c \
  "INSERT INTO audit.event (kind, payload, actor) VALUES (
     'secret.rotated',
     jsonb_build_object('secret', 'redis_password', 'at', NOW()),
     '${OPERATOR_EMAIL}'
   )"
```

This is consumed by the cross-witness reconciler; the rotation event
anchors to Polygon + Fabric on the next anchoring sweep.

---

## Procedure — Vault AppRole token (auto-issued)

AppRole tokens have a TTL of 1 hour. Vault auto-issues a new token
every hour via the `AppRole` auth method. The worker reads the token
file at startup; subsequent ESO refreshes deliver the rolling token
into the same file. **The worker continues to operate** because the
ioredis / pg connections are already established; the Vault token is
only used at process start.

**No operator action is required** for routine AppRole token rotation.

If the AppRole role is rotated (rare; only on compromise or
governance-policy change), the procedure is identical to the
Redis/Postgres flow above: update the Vault role, ESO sync, pod
restart, retire old.

---

## Procedure — Turnstile secret (Cloudflare-rotated)

Cloudflare rotates Turnstile secrets via the Cloudflare dashboard or
API. The new secret must land in Vault before pods restart:

1. Generate new secret in Cloudflare dashboard for the
   `vigilapex.cm/tip` site.
2. `vault kv put vigil/turnstile secret_key="<new-secret>"`.
3. Wait for ESO sync (or `force-sync` annotation).
4. Restart the dashboard pods:
   `kubectl -n vigil rollout restart deployment/dashboard`.
5. Retire the OLD Turnstile secret in the Cloudflare dashboard.
6. Audit log entry.

The tip-submit route reads `TURNSTILE_SECRET_KEY` at request time per
its file-mount injection, but per the standard pattern, the worker /
dashboard process reads the env once at boot. The `/api/tip/submit`
route does NOT re-read the file per request (see
`apps/dashboard/src/app/api/tip/submit/route.ts:30-37` — `process.env`
access happens inside the handler but resolves to the boot-time
environment).

---

## Procedure — TLS certificate (cert-manager auto-renewal)

`cert-manager` in the cluster auto-renews Let's Encrypt certs every
60 days. The renewed cert lands in a Kubernetes Secret; Caddy's
ConfigMap reload picks it up automatically.

**No operator action** for routine renewal. The
`certificate_expiry_days_remaining` Prometheus alert (mode 6.6
closure) fires at < 14 days remaining; if cert-manager has failed,
the alert is your signal to investigate.

---

## Smoke test — what we DON'T have (yet)

The orientation's Q4 mentions a "periodic smoke test that rotates a
test secret + verifies ExternalSecret sync within 90 s + kills pod to
confirm new value mounted." This is genuinely valuable but lives at
the cluster-integration test tier, not the unit-test tier:

- Requires a live Vault + ESO + a sacrificial test workload.
- Best run as part of the quarterly DR rehearsal
  (`docs/runbooks/dr-rehearsal.md`), not as a per-PR CI gate.

Status: **flagged as a DR-rehearsal additive**. The next quarterly
rehearsal includes this smoke test in its scenario list.

What we DO have today:

- The unit test
  `packages/queue/__tests__/secret-rotation.test.ts` pins the
  `loadRedisPassword` contract (re-reads on every call; documented
  posture that QueueClient calls it once at init).
- The DB-side pattern in `packages/db-postgres/src/client.ts:46-50`
  is identical in shape; same posture, no separate test today.

---

## Re-open trigger — when to revisit hot-reload

Move mode 9.2 from N/A back to OPEN (and consider Vault Agent sidecar
hot-reload) if any of:

1. **A rotation incident causes operator-visible downtime.** Currently
   workers tolerate a 30-second rolling restart cleanly; if a future
   workload (long-running batch?) can't tolerate this, the sidecar
   gets cheaper-than-the-alternative.

2. **Pod churn from rotation triggers a deploy-noise alert.** If
   rotation cadence rises (quarterly → monthly), the operational
   noise of full-fleet restarts may push us toward in-process refresh.

3. **A compliance auditor requires shorter credential exposure
   windows.** Hot-reload reduces the worst-case exposure from
   "current quarter" to "current minute"; if the regulator wants the
   latter, the sidecar is the answer.

If any fires, the closure path is: ship Vault Agent Injector + a
SIGHUP / inotify-based re-read in each client + the corresponding
test update. Estimated 1–3 days.

---

## Related

- `packages/queue/__tests__/secret-rotation.test.ts` — the unit test
  that pins the contract.
- `packages/queue/src/client.ts` — `loadRedisPassword` + the
  constructor's single call site.
- `packages/db-postgres/src/client.ts:46-50` — the DB-side equivalent
  (inline, no extracted function).
- `infra/k8s/charts/vigil-apex/templates/externalsecret-*.yaml` —
  per-secret ExternalSecret resources synced by ESO from Vault.
- `docs/runbooks/vault.md` — Vault operations (sealed/unsealed,
  Shamir ceremony, AppRole policies).
- `docs/runbooks/vault-raft-reattach.md` — re-attaching a Vault Raft
  voter after node loss (different operation than secret rotation).
- `docs/audit/evidence/hardening/category-9/mode-9.2/CLOSURE.md` — the
  mode 9.2 closure that ratifies this posture.
