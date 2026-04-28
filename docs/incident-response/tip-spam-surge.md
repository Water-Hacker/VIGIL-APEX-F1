# IR-01 — Tip-spam surge

**Severity:** warning (auto-escalates to critical if /api/tip/submit
goes 5xx for > 5 min). **Roles needed:** operator on-call.

## Detection
- AlertManager fires `TipSubmitFloodPattern` (rate of /api/tip/submit
  > 100/min sustained for 10 min, OR Turnstile rejection rate > 50%).
- Grafana → vigil-overview shows `vigil_events_consumed_total{worker="worker-tip-triage"}`
  spiking with a corresponding rise in dead-letter rows.

## Containment (target: 5 min)
1. **Confirm not legitimate.** Check tip-portal access logs from
   geographically diverse IPs vs concentrated. Legit civic surges
   come from many regions; bot floods cluster.
2. **Tighten Caddy rate-limit.** Edit
   `infra/docker/caddy/Caddyfile` `tip_submit` zone from 5/min to 1/min:
   ```caddy
   rate_limit @tip_submit { zone tip_submit { events 1; window 1m } }
   ```
   Reload: `docker exec vigil-caddy caddy reload --config /etc/caddy/Caddyfile`.
3. **Cloudflare Turnstile interactive challenge.** Switch the sitekey
   to the "interactive" widget by setting
   `NEXT_PUBLIC_TURNSTILE_SITEKEY` to the interactive variant in the
   dashboard env, restart the dashboard replicas.

## Eradication (1 hr)
4. **Block source ASNs at Caddy.** If logs show an ASN concentration,
   add a `@blocked_asn` matcher to the Caddyfile sourcing the ASN list
   from MaxMind. Reload Caddy.
5. **Quarantine the spam tips.** They've already been persisted (the
   server NEVER reads plaintext, so even spam content stays sealed).
   Mark dispositions as `SPAM` so the council quorum decryption flow
   doesn't even consider them:
   ```sql
   UPDATE tip.tip SET disposition = 'SPAM'
   WHERE received_at > NOW() - INTERVAL '1 hour'
     AND id IN (SELECT id FROM tip.tip WHERE region IS NULL);
   ```

## Recovery
6. After 6 h with rate-limit at 1/min and no further surge, restore
   normal limits (5/min). Document the surge in
   `docs/decisions/log.md`.

## Lessons
- If recurrent: budget for 10K/year tips means a sustained 1+/min is
  legitimate. Re-tune the alert threshold instead of clamping.
- Update `docs/SLOs.md` if the warning fires more than once a quarter.
