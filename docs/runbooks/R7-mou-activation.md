# R7 — MOU activation (MINFI / BEAC / ANIF)

**When to run:** when the architect (or backup architect) has the
countersigned MOU paper-in-hand AND the partner institution has issued
operational credentials. One pass per institution; the three MOUs are
independent and may land months apart.

**Prerequisites:**
- Phase-1 stack deployed and healthy (`make compose-up` green)
- Vault unsealed and `06-vault-policies.sh` already applied
- `worker-adapter-repair` running (Phase H1) — first-contact failures
  on the new adapter are benign on day one but should be visible
  immediately

## MINFI — Budget Information System (mTLS)

1. **Receive credentials from MINFI/DGTCFM:**
   - `client.crt` (X.509, ECC P-256, signed by MINFI internal CA)
   - `client.key` (PKCS#8, password-less; the password rotation is in
     the MOU's annex 3)
   - `ca.crt` (MINFI root)
   - The exact base URL and any per-tenant prefix

2. **Provision Vault paths:**
   ```sh
   vault kv put secret/vigil/minfi-bis/client_cert pem="$(< client.crt)"
   vault kv put secret/vigil/minfi-bis/client_key  pem="$(< client.key)"
   vault kv put secret/vigil/minfi-bis/ca_cert     pem="$(< ca.crt)"
   ```

3. **Set env on the adapter-runner container:**
   ```sh
   echo 'MINFI_BIS_ENABLED=1'              >> /etc/vigil/adapter-runner.env
   echo 'MINFI_BIS_BASE_URL=<MOU-given>'   >> /etc/vigil/adapter-runner.env
   ```

4. **Re-materialise + restart:**
   ```sh
   sudo /usr/local/bin/vigil-secret-materialisation
   docker compose restart adapter-runner
   ```

5. **Verify:**
   - `docker logs adapter-runner | grep minfi-bis` should show
     `minfi-bis-run-complete pages=N events=M` instead of the
     placeholder "MOU pending" line
   - Grafana → vigil-adapters: `minfi-bis` row appears with non-zero
     `vigil_adapter_rows_emitted_total`

## BEAC — payment-system bridge (OAuth2 client_credentials)

1. **Receive credentials from BEAC Yaoundé:**
   - `tenant_id`
   - `client_id`
   - `client_secret`
   - The token URL (typically `https://auth.beac.int/oauth2/token`)
   - The base URL for the digest endpoint

2. **Provision Vault paths:**
   ```sh
   vault kv put secret/vigil/beac/tenant_id     value=<tenant_id>
   vault kv put secret/vigil/beac/client_id     value=<client_id>
   vault kv put secret/vigil/beac/client_secret value=<client_secret>
   ```

3. **Set env:**
   ```sh
   echo 'BEAC_ENABLED=1'      >> /etc/vigil/adapter-runner.env
   echo 'BEAC_BASE_URL=<...>' >> /etc/vigil/adapter-runner.env
   echo 'BEAC_TOKEN_URL=<...>'>> /etc/vigil/adapter-runner.env
   ```

4. **Re-materialise + restart**, **verify** — same shape as MINFI.

5. **Manual smoke (one-shot):**
   ```sh
   docker compose run --rm adapter-runner \
     node dist/index.js --once --source beac-payments
   ```
   On a clean MOU-day this should pull a non-empty digest and show
   `events: <n>` in the log.

## ANIF — AML / PEP screening (API key)

1. **Receive credentials:**
   - `X-ANIF-Key` value (rotated quarterly per the MOU)
   - The base URL

2. **Provision Vault path:**
   ```sh
   vault kv put secret/vigil/anif/api_key value=<key>
   ```

3. **Set env:**
   ```sh
   echo 'ANIF_ENABLED=1'      >> /etc/vigil/adapter-runner.env
   echo 'ANIF_BASE_URL=<...>' >> /etc/vigil/adapter-runner.env
   ```

4. **Re-materialise + restart**, **verify**.

## Post-activation — operator checklist

For every MOU activated, complete the following within 7 days:

- [ ] `vigil-key-rotation` quarterly timer covers the new credential
      type (already true for `vault-tokens` and `mtls`; ANIF API key
      requires manual addition to `tools/vigil-key-rotation/main.sh`)
- [ ] `worker-adapter-repair` does NOT auto-promote selectors for
      these adapters (they're API-driven, not selector-driven; the
      `CRITICAL_ADAPTERS` set already includes `minfi-bis` /
      `beac-payments` / `anif-amlscreen` — verify in
      `apps/worker-adapter-repair/src/types.ts`)
- [ ] Append a row to `docs/decisions/log.md` recording the MOU
      effective date and the architect signature
- [ ] Update `ROADMAP.md` Phase 2 stanza marking the institutional
      precondition as ✅ for that MOU

## Rollback

If the credentials prove broken or the upstream institution requests
a pause:

```sh
sed -i 's/<NAME>_ENABLED=1/<NAME>_ENABLED=0/' /etc/vigil/adapter-runner.env
docker compose restart adapter-runner
```

The adapter immediately reverts to its no-op placeholder behaviour.
The events already in `source.events` stay; no data is lost. To wipe
events from a specific source after a rollback (e.g. ingested under
flawed credentials):

```sql
DELETE FROM source.events WHERE source_id = '<source-id>'
  AND observed_at >= '<rollback-cutoff>';
```

This is an audit-significant operation; schedule it during a
maintenance window and append a `docs/decisions/log.md` row.
