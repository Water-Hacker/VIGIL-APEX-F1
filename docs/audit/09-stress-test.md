# Live-Fire Stress Test — Deferred (Requires Running Stack)

**Status:** All Section-11 live-fire tests deferred. This document records the test specifications and operator commands needed to execute each one against a running platform.

---

## Why deferred

The audit was performed in a single session by a read-only agent. The Section-11 stress tests in the audit spec require:

- Running Postgres + Neo4j + Redis + Vault + Keycloak + IPFS + Polygon RPC + Hyperledger Fabric peer + Caddy
- Production-equivalent worker fleet (worker-anchor, worker-fabric-bridge, worker-pattern, worker-conac-sftp, worker-audit-watch, worker-tip-triage, worker-extractor, worker-counter-evidence, worker-dossier, worker-governance, worker-federation-receiver, etc.)
- Load-test tooling (autocannon, k6, hey)
- Chrome + Lighthouse
- Multiple browsers + simulated council-member sessions (concurrent vote ceremony)

These cannot be brought up from a static-read audit session. They are explicitly listed in the spec under "Where a stress test cannot run against real production infrastructure, document the substitute used and the residual verification that real deployment will require." — this document records that residual verification list.

---

## Pre-flight to run these tests

When the architect is ready to perform live-fire:

```bash
# Bring up full stack
make smoke   # or docker compose -f infra/docker/compose.yaml up -d

# Wait for healthchecks
docker compose ps

# Run the deferred audit-chain replay tests in doc 08 section 6 first
pnpm --filter @vigil/audit-chain run verify --from=1 --to=100
```

Save all stress-test outputs to `docs/audit/evidence/stress-test/<test-id>/`.

---

## 11.1 Load

**Spec:** 1,000 concurrent requests at the operator dashboard's heaviest screen; measure p50/p95/p99; confirm rate-limiter activates; confirm DB pool does not exhaust; confirm Sentry signal.

**Operator command:**

```bash
# Acquire a JWT via Keycloak first; export as $JWT
export TARGET=http://localhost:3000/findings
autocannon -c 100 -d 60 -H "Cookie: vigil_access_token=$JWT" $TARGET \
  > docs/audit/evidence/stress-test/11.1-load/autocannon.txt

# Or with k6:
k6 run --vus 100 --duration 60s load-tests/findings.k6.js
```

**Expected outcome:** p95 < 500 ms; rate limiter activates at documented threshold (Caddyfile:166–173 for tip portal; check operator dashboard limit separately); DB pool stays under `POSTGRES_POOL_MAX`; Sentry receives error events for any 5xx.

**Pre-flight check (already known to be partial):** The dashboard has no `/api/health/load-test` endpoint dedicated to load testing. Use existing operator routes.

---

## 11.2 Database failure

**Spec:** Kill Postgres mid-flight; confirm dashboard renders degraded state; confirm no partial commits; confirm recovery without manual intervention.

**Operator command:**

```bash
# In one shell, fire requests
while true; do curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: vigil_access_token=$JWT" http://localhost:3000/findings; done

# In another shell, kill Postgres
docker stop vigil-postgres

# Observe dashboard response (5xx with degraded state? 502?)
# After 30 seconds:
docker start vigil-postgres

# Time to recovery (last 5xx → first 2xx)
```

**Expected:** Dashboard returns degraded-state UI rather than blank 500; in-flight transactions rolled back; auto-recovers within ~10s of Postgres up.

**Critical thing to check:** Does the dashboard show a useful error message ("Database temporarily unavailable, retry in a moment") or a stack trace? Stack trace = finding.

---

## 11.3 Ingestion source format change

**Spec:** Mutate the response from one ingestion source; confirm structured error + dead-letter + alert; confirm other adapters continue.

**Operator command:**

```bash
# Use a local stub for one source
# Edit apps/adapter-runner/src/adapters/minfi-procurement.ts → temporarily point to broken endpoint
# Restart adapter-runner
# Wait one scrape cycle
# Check dashboard /dead-letter for the failed envelope
# Check Prometheus for adapter error metric
```

**Expected:** Failed envelope appears in `/dead-letter` (route gated by `operator, architect`); other adapters continue scraping unaffected; structured Sentry signal.

---

## 11.4 Audit chain divergence

**Spec:** Insert audit entry into Postgres without reaching Polygon; run reconciliation; confirm gap detected and backfilled-or-alerted.

**Operator command:**

```sql
-- Insert a manual row to simulate witness loss
INSERT INTO audit.actions (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash, inserted_at)
SELECT gen_random_uuid(), (SELECT MAX(seq)+1 FROM audit.actions), 'test.divergence', 'audit:test', 'test', 'gap-test', NOW(), '{}'::jsonb, body_hash, decode('00'||repeat('11',31), 'hex'), NOW()
FROM audit.actions ORDER BY seq DESC LIMIT 1;
```

**Expected (per F-AC-01 in doc 08):** Cross-witness verifier detects the gap. But there's **no automated reconciliation** — operator must manually run `pnpm --filter @vigil/audit-verifier run cross-witness`. This confirms F-AC-01 as a CRITICAL finding requiring closure before production.

---

## 11.5 Concurrent council votes

**Spec:** Two pillars submit votes on same proposal in milliseconds; confirm no double-count and consistent final state.

**Operator command:** Requires two browsers + two YubiKeys + Keycloak users wired in. Out of scope for static audit. Council vote correctness is enforced on-chain by `VIGILGovernance.sol:221` (NOT_VOTED sentinel check + `AlreadyVoted` revert).

**Static assurance:** Contract-level replay prevention is sound (see doc 03 Flow 4). Concurrent submission produces deterministic on-chain ordering via Polygon block ordering.

---

## 11.6 Forbidden access attack

**Spec:** As `civil_society`, attempt every operator route via URL manipulation, direct API call, malformed JWT, JWT with elevated capabilities, missing JWT, expired JWT. Confirm 403 + audit chain records + no info leak.

**Operator command:**

```bash
# Acquire civil_society JWT; export as $CS_JWT
for route in /findings /dead-letter /calibration /audit/ai-safety /triage/tips /council/proposals; do
  echo "=== $route ==="
  # URL manipulation
  curl -s -o /dev/null -w "GET %{http_code}\n" -H "Cookie: vigil_access_token=$CS_JWT" http://localhost:3000$route
  # API call
  curl -s -o /dev/null -w "API %{http_code}\n" -H "Cookie: vigil_access_token=$CS_JWT" http://localhost:3000/api$route
  # Malformed JWT
  curl -s -o /dev/null -w "BAD %{http_code}\n" -H "Cookie: vigil_access_token=invalid.jwt.signature" http://localhost:3000$route
  # Missing JWT
  curl -s -o /dev/null -w "NONE %{http_code}\n" http://localhost:3000$route
done

# Check audit chain for entries
psql -c "SELECT seq, action, actor, subject_id FROM audit.actions WHERE action LIKE '%denied%' OR action LIKE '%forbidden%' ORDER BY seq DESC LIMIT 20"
```

**Expected:**

- All return 403 (or 302 for missing JWT on HTML routes).
- **F-DF-03 (CRITICAL):** No audit entries logged. Confirmed via static analysis — middleware.ts:156–158 silent rewrite to /403, no audit emission.

**Expected after F-DF-03 closure:** Each forbidden attempt produces a row in audit.actions with action `access.forbidden` and full context.

---

## 11.7 Tip portal hardening

**Spec:** EXIF GPS strip on attachment; rate limit at threshold; malformed body rejection; max body size; Tor exit handling; public bundle inspection.

**Static verification already complete (see doc 02 section C /tip):**

- ✓ EXIF strip via canvas re-encode (attachment-picker.tsx:304–344)
- ✓ Rate limit 5/min/IP via Caddy (Caddyfile:166–173)
- ✓ Magic-byte + canonical-base64 validation (submit/route.ts:115–189)
- ✓ Body size enforced (`request.body` Next.js bodyParser limit + explicit checks)
- ✓ No IP in DB (schema/tip.ts:19–43 has no client_ip column)
- ✓ No third-party analytics (grep clean)
- ✓ Public bundle uses only NEXT*PUBLIC*\* env vars

**Live-fire verification needed for:** behavior under sustained Tor traffic, real Cloudflare Turnstile failure modes.

---

## 11.8 LLM hallucination injection

**Spec:** For each of 12 LLM safety layers, design adversarial input that targets that layer; confirm the layer activates.

**Operator command:** Requires running `worker-extractor`, `worker-counter-evidence`, etc., with `AI-SAFETY-DOCTRINE-v1.md` reference document available.

**Static finding:** SafeLlmRouter chokepoint exists at `packages/llm/src/providers/` (per recon). Need to verify every LLM call site routes through it (see doc 04 § Internal components — SafeLlmRouter bypass risk).

**Operator should run** `tests/llm-canaries/` (per `AI-SAFETY-DOCTRINE-v1.md`) — these are the 12-layer adversarial tests.

---

## 11.9 Worker crash recovery

**Spec:** Kill a worker; confirm restart policy revives it; confirm in-flight messages handled correctly.

**Operator command:**

```bash
docker ps | grep worker-pattern
docker kill <container>
# Wait
docker ps | grep worker-pattern  # should show new container

# Check Redis stream consumer group lag
redis-cli XINFO GROUPS audit:publish:stream
```

**Expected:** Docker restart policy `unless-stopped` (compose.yaml) brings worker back; in-flight messages re-delivered via consumer group; no orphans in dead-letter beyond max-retry threshold.

---

## 11.10 Build-time regression

**Spec:** Add a new operator page without adding it to the capability matrix; build should fail with clear error naming the unmapped page.

**Test path:** Since there is no separate capability matrix file (see doc 05 § FIND-P02), this guard does not exist today. The middleware ROUTE_RULES is hardcoded. Adding a new operator page without a corresponding ROUTE_RULES entry would result in **the page being publicly accessible** (no matching prefix → middleware does not block).

**Critical finding F-ST-01 (CRITICAL):** No build-time regression protection for unmapped operator routes.

**Remediation:** Add a build-time check (TypeScript ts-node script run by pnpm build):

1. Read all `apps/dashboard/src/app/(operator)/**/page.tsx` paths.
2. Read all prefixes in `middleware.ts:ROUTE_RULES`.
3. Fail if any operator page has no matching ROUTE_RULES prefix.

---

## 11.11 Vault unsealing failure

**Spec:** Vault sealed at startup; platform refuses to start (fail-closed); no fallback to hardcoded keys.

**Operator command:**

```bash
docker stop vigil-vault
docker compose up dashboard
# Should fail to start; logs should reference Vault unreachable
```

**Static check:** Search `packages/security/src/vault.ts` for any fallback/default-secret path. Per agent recon, none found.

---

## 11.12 Time skew

**Spec:** Set host clock 5 min ahead; submit audit event; confirm either rejection or prominent skew note.

**Operator command:**

```bash
sudo date -s "+5 minutes"
# Submit audit event
# Check audit chain for skew flag in payload
sudo timedatectl set-ntp true  # restore
```

**Static check:** Search for clock-skew handling in `packages/audit-chain/`, `packages/audit-log/`, `tools/vigil-polygon-signer/`. No explicit skew rejection found; relies on Polygon block time consensus.

---

## 11.13 Configuration drift

**Spec:** Inspect running env vars vs `.env.example`; flag undocumented, unused, or accidentally logged.

**Static-analysis approach (no running stack needed):**

```bash
# Find every process.env access
grep -rEho 'process\.env\.[A-Z_]+' apps packages | sort -u > /tmp/env-used.txt
# Compare with documented
grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort -u > /tmp/env-documented.txt
# Diff
comm -23 /tmp/env-used.txt /tmp/env-documented.txt > /tmp/env-undocumented.txt
comm -13 /tmp/env-used.txt /tmp/env-documented.txt > /tmp/env-unused.txt
wc -l /tmp/env-undocumented.txt /tmp/env-unused.txt
```

This is doable from this static-only session and is documented in doc 04 (failure-modes) for context.

---

## Summary

All 13 live-fire tests are documented with operator commands. Two findings surface even from the static planning:

| ID                     | Severity | Title                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| F-ST-01                | CRITICAL | No build-time regression check for unmapped operator routes (11.10) |
| F-DF-03 (also flagged) | CRITICAL | Forbidden-access not audited (11.6 will confirm)                    |

When the architect runs the live-fire phase, the catalogue in doc 10 may grow. This document is the test harness; it does not by itself catalogue findings beyond what static analysis already surfaced.
