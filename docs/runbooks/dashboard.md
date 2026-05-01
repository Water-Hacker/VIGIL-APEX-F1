# Runbook — dashboard

> Next.js operator + council + public-verify + tip-portal + public-audit
> surfaces. Owns the full council admin / WebAuthn surface — touches
> council state, so **this runbook owns its share of the R4 content**
> alongside [worker-governance.md](./worker-governance.md).
>
> **Service:** [`apps/dashboard/`](../../apps/dashboard/) — internet-facing reverse-proxied edge service.

---

## Description

### 🇫🇷

Frontend Next.js 14 multi-surface :

- `/findings` (opérateur) — triage, escalade, recusal.
- `/council` (conseil) — vote-ceremony WebAuthn ; admin pillar
  rotation (R4).
- `/verify/[ref]` (public) — vérification d'un dossier publié.
- `/tip` (public) — soumission de tips chiffrés (sealed box vers
  operator-team pubkey).
- `/public/audit` (public) — feed d'événements d'audit redacté.

Tous les writes vont via `audit(req, spec, work)` (DECISION-012
halt-on-failure) ; un échec d'émission → 503 `Retry-After: 30`.

### 🇬🇧

Next.js 14 multi-surface frontend:

- `/findings` (operator) — triage, escalation, recusal.
- `/council` (council) — vote-ceremony WebAuthn; admin pillar
  rotation (R4).
- `/verify/[ref]` (public) — verify a published dossier.
- `/tip` (public) — encrypted tip submission (sealed box to
  operator-team pubkey).
- `/public/audit` (public) — redacted audit-event feed.

All writes go through `audit(req, spec, work)` (DECISION-012
halt-on-failure); audit-emit failure → 503 `Retry-After: 30`.

---

## Boot sequence

1. Next.js standalone build.
2. Postgres connection via `getDb()`.
3. `audit-bridge` UDS socket mounted at `/run/vigil/audit-bridge.sock`.
4. Keycloak OIDC client init.
5. Vault client (read-only operator surface secrets).

---

## Health-check signals

| Metric                          | Healthy | Unhealthy → action                              |
| ------------------------------- | ------- | ----------------------------------------------- |
| HTTP `/api/health`              | 200     | non-200 > 60 s → P1                             |
| `up{instance=~".*dashboard.*"}` | `1`     | `0` > 2 min → P1                                |
| `audit-bridge` UDS reachable    | true    | not reachable → halt-on-failure (503 on writes) |

## SLO signals

| Metric                                    | SLO target | Investigate-worthy               |
| ----------------------------------------- | ---------- | -------------------------------- |
| `/api/audit/public` p99 latency           | < 500 ms   | > 2 s → cache miss or DB slow    |
| Tip-portal POST latency p99               | < 1 s      | > 5 s → libsodium / IPFS slow    |
| Council vote-ceremony WebAuthn round-trip | < 3 s      | > 10 s → Keycloak slow           |
| Public verify route p99                   | < 200 ms   | > 1 s → Polygon RPC slow on read |

---

## Common failures

| Symptom                                                | Likely cause                                           | Mitigation                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| All writes return 503 with `audit-emitter-unavailable` | audit-bridge down                                      | See [audit-bridge.md](./audit-bridge.md). Restart bridge first.                                                    |
| Tip submissions failing                                | TIP_OPERATOR_TEAM_PUBKEY PLACEHOLDER OR expired        | Block-A A9 guard returns 503 with `tip-key-expired`. Rotate per [worker-tip-triage.md R3](./worker-tip-triage.md). |
| WebAuthn assertion always fails                        | Keycloak realm config drift OR challenge TTL too short | See [keycloak.md](./keycloak.md).                                                                                  |
| Public-audit feed showing leaked PII                   | `toPublicView` redaction regression                    | Page architect 24/7. Halt the public route until verified.                                                         |

---

## R1 — Routine deploy

```sh
docker compose pull dashboard
docker compose up -d dashboard
```

Verify within 30 s:

- `/api/health` → 200.
- `/api/audit/public?limit=5` → 200, returns events array.
- `/verify/<known-ref>` → 200.

## R2 — Restore from backup

Reads from Postgres + IPFS. No local state. Restart after upstream
restores.

## R3 — Credential rotation

**Two key creds:**

1. **Keycloak OIDC client secret** — see [keycloak.md R3](./keycloak.md).
   Dashboard re-reads `KEYCLOAK_CLIENT_SECRET_FILE` on restart.

2. **Session signing key** — `DASHBOARD_SESSION_SECRET` Vault path:

   ```sh
   NEW_SECRET="$(openssl rand -base64 64)"
   vault kv put secret/dashboard session_secret="$NEW_SECRET"
   docker compose restart dashboard
   ```

   Active operator sessions invalidated; re-login required (acceptable
   off-peak).

Quarterly per HSK-v1 §6.

## R5 — Incident response

| Severity | Trigger                                                       | Action                                                                                              |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **P0**   | Public-audit feed leaking unredacted content                  | Page architect 24/7 IMMEDIATELY. Halt `/public/audit` route. Verify `toPublicView` regression test. |
| **P0**   | Tip portal accepting tips without ciphertext (PUBKEY missing) | Page architect. Halt `/tip` until rotation per worker-tip-triage R3.                                |
| **P1**   | Dashboard down + operator review halts                        | Page on-call.                                                                                       |
| **P2**   | Single-route 5xx (e.g., `/triage/tips`) sustained             | Operator triage; check upstream worker health.                                                      |
| **P3**   | a11y regression                                               | Per dashboard a11y suite (CI) — fix in next deploy.                                                 |

## R4 — Council pillar rotation

**Full content here.** The dashboard council portal is the operator
surface for the rotation ceremony per
[R4-council-rotation.md](./R4-council-rotation.md):

- `/council/admin/rotation` — architect-only via WebAuthn challenge;
  presents the outgoing pillar's row + new pillar registration form.
- WebAuthn credential of the new pillar registered in Keycloak via
  the dashboard's admin surface.
- Audit emit (`governance.pillar_terminated` +
  `governance.pillar_appointed`) flows through audit-bridge.

The application-state half is shared with
[worker-governance.md R4](./worker-governance.md); the cryptographic
half (rekey of Vault Shamir shares) is in [vault.md R3](./vault.md).

## R6 — Monthly DR exercise

Dashboard recovery is post-postgres + post-Keycloak. Tip portal +
public verify path rejoin the SLA budget within ~10 min after both
upstreams are healthy.

---

## Cross-references

### Code

- [`apps/dashboard/src/app/`](../../apps/dashboard/src/app/) — Next.js routes.
- [`apps/dashboard/src/lib/audit-emit.server.ts`](../../apps/dashboard/src/lib/audit-emit.server.ts) — halt-on-failure wrapper.
- [`apps/dashboard/src/middleware.ts`](../../apps/dashboard/src/middleware.ts) — auth + public-route allowlist.
- [`apps/dashboard/__tests__/public-audit-route.test.ts`](../../apps/dashboard/__tests__/public-audit-route.test.ts) — redaction regression.
- [`apps/dashboard/__tests__/doc-banners.test.ts`](../../apps/dashboard/__tests__/doc-banners.test.ts) — doc-drift regression (Block-A §2.A.9).

### Binding spec

- **SRD §27.1** — three surfaces (operator, council, public).
- **SRD §28** — council vote ceremony.
- **DECISION-008 C5b** — WebAuthn fallback.
- **DECISION-010** — per-body dossier delivery (verify route).
- **DECISION-012** — TAL-PA halt-on-failure.
- **DECISION-016** — tip retention guarantee.
- **HSK-v1 §6** — credential rotation cadence.
