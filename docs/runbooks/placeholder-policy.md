# PLACEHOLDER Discipline (Tier-1 Boot Guard)

> Resolves the `A9` work-program item. Documents which env values are
> **refused at boot** vs **gracefully degraded** vs **dev-only defaults**,
> and the audit pattern each worker follows.

## Three tiers

### Tier 1 — Refuse to boot

If the env value is `PLACEHOLDER` (or starts with `PLACEHOLDER_`), the
worker throws and exits non-zero before any business logic runs. Used for
values where running with a placeholder would silently produce
production-invalid output (e.g. unsigned dossiers, exports without a salt).

| Worker / Service                | Variable                                     | Guard reference                                                                                      |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| worker-conac-sftp               | `GPG_FINGERPRINT`                            | [src/index.ts:46](../../apps/worker-conac-sftp/src/index.ts#L46)                                     |
| worker-conac-sftp               | `delivery_targets[*].host` (per active body) | [src/index.ts:104](../../apps/worker-conac-sftp/src/index.ts#L104)                                   |
| worker-conac-sftp               | signer pubkey path / certificate             | [src/index.ts:37](../../apps/worker-conac-sftp/src/index.ts#L37)                                     |
| worker-dossier                  | `GPG_FINGERPRINT`                            | [src/index.ts:288](../../apps/worker-dossier/src/index.ts#L288)                                      |
| dashboard `/api/tip/public-key` | `TIP_OPERATOR_TEAM_PUBKEY`                   | [route.ts:12](../../apps/dashboard/src/app/api/tip/public-key/route.ts#L12)                          |
| adapter-runner quarterly export | `AUDIT_PUBLIC_EXPORT_SALT`                   | [quarterly-audit-export.ts:83](../../apps/adapter-runner/src/triggers/quarterly-audit-export.ts#L83) |
| worker-anchor                   | `POLYGON_ANCHOR_CONTRACT`                    | [src/index.ts](../../apps/worker-anchor/src/index.ts) (null-address check)                           |

### Tier 2 — Feature-flag (gracefully degrade)

Optional integrations whose absence the system can run without. The worker
checks the flag, logs a notice, and continues without that capability.

| Variable                                        | Default   | Effect when PLACEHOLDER               |
| ----------------------------------------------- | --------- | ------------------------------------- |
| `PLANET_API_KEY` / `PLANET_NICFI_ENABLED=false` | disabled  | Sentinel-2 only; no NICFI close-view  |
| `MAXAR_API_KEY` / `AIRBUS_API_KEY`              | gated off | not procured; never called            |
| `SENTINEL_HUB_CLIENT_ID/SECRET`                 | optional  | fallback to public Sentinel-2 STAC    |
| `MAPBOX_ACCESS_TOKEN`                           | optional  | dashboard map falls back to list view |

### Tier 3 — Dev-only sensible default

Localhost addresses and ports that are correct for `pnpm compose:up` but
get overridden in production via Vault.

| Variable                | Default                          |
| ----------------------- | -------------------------------- |
| `IPFS_API_URL`          | `http://vigil-ipfs:5001`         |
| `POLYGON_SIGNER_SOCKET` | `/run/vigil/polygon-signer.sock` |
| `AUDIT_BRIDGE_SOCKET`   | `/run/vigil/audit-bridge.sock`   |
| `POSTGRES_*`, `REDIS_*` | local docker-compose values      |

## Pattern for new workers

A new worker that reads any env var should follow this template:

```ts
const v = process.env.MY_NEW_VAR;
if (!v || v.startsWith('PLACEHOLDER')) {
  throw new Error(
    'MY_NEW_VAR is unset or PLACEHOLDER; refusing to start <worker> without <thing it gates>',
  );
}
```

If the var is optional / feature-flagged, prefer:

```ts
const v = process.env.MY_NEW_VAR;
if (!v || v === 'PLACEHOLDER') {
  logger.info(
    'MY_NEW_VAR not set; skipping <feature> (Tier-2 graceful degradation)',
  );
  return;
}
```

## Audit

Every PLACEHOLDER in [.env.example](../../.env.example) MUST be classified
into one of the three tiers above. Use the inline comment column to declare
the tier:

```
PLANET_API_KEY=PLACEHOLDER                    # Tier-2 (graceful degrade)
AUDIT_PUBLIC_EXPORT_SALT=PLACEHOLDER          # Tier-1 (refuse to boot)
IPFS_API_URL=http://vigil-ipfs:5001           # Tier-3 (dev default)
```

CI gate (recommended): `scripts/check-placeholder-policy.sh` walks
`.env.example` and fails if any unannotated PLACEHOLDER appears.
