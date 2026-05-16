import { readFile } from 'node:fs/promises';

import { createLogger, vaultTokenRenewFailedTotal, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';
import nodeVault from 'node-vault';

import { type Secret, wrapSecret } from './secrets.js';

/**
 * HashiCorp Vault client.
 *
 * Per SRD §17.6 / §17.12: workers do NOT use the root token. Each worker has
 * a Vault policy granting minimum permissions. The boot-time secret on the
 * container's filesystem (`/run/secrets/vault_token_worker`) is itself a
 * renewable token with 1h TTL. This client auto-renews leases.
 */

export interface VaultClientOptions {
  readonly addr?: string;
  readonly tokenFile?: string;
  readonly token?: string;
  readonly namespace?: string;
  readonly kvMount?: string;
  readonly logger?: Logger;
}

export class VaultClient {
  private vault: ReturnType<typeof nodeVault>;
  private readonly logger: Logger;
  private readonly kvMount: string;
  private renewTimer: NodeJS.Timeout | null = null;
  // Tier-25 audit closure: track consecutive token-renew failures. The
  // pre-fix loop incremented a metric but kept firing forever — a
  // wedged Vault would leave the worker holding an expired token until
  // the next vault.read 403'd. After N consecutive failures we surface
  // a structured fatal log + emit a synthetic error event so the
  // operator alert fires before any secret-using path errors out.
  private consecutiveRenewFailures = 0;
  private static readonly MAX_CONSECUTIVE_RENEW_FAILURES = 5;

  private constructor(client: ReturnType<typeof nodeVault>, opts: VaultClientOptions) {
    this.vault = client;
    this.logger = opts.logger ?? createLogger({ service: 'vault-client' });
    this.kvMount = opts.kvMount ?? process.env.VAULT_KV_MOUNT ?? 'secret';
  }

  static async connect(opts: VaultClientOptions = {}): Promise<VaultClient> {
    const addr = opts.addr ?? process.env.VAULT_ADDR ?? 'http://vigil-vault:8200';
    let token = opts.token;
    if (!token) {
      const file = opts.tokenFile ?? process.env.VAULT_TOKEN_FILE;
      if (!file) {
        throw new Errors.VaultUnsealError('no token source configured (VAULT_TOKEN_FILE)');
      }
      token = (await readFile(file, 'utf8')).trim();
    }
    const namespace = opts.namespace ?? process.env.VAULT_NAMESPACE;
    // Tier-0 audit closure: cap Vault request time so a hung Vault
    // (network partition, sealed-during-request, misbehaving sidecar)
    // doesn't hang the worker's secret-access path indefinitely. 30s
    // is generous for KV reads + token renewals; tunable via env.
    const requestTimeoutMs = Number(process.env.VAULT_REQUEST_TIMEOUT_MS ?? 30_000);
    const client = nodeVault({
      apiVersion: 'v1',
      endpoint: addr,
      token,
      ...(namespace !== undefined && { namespace }),
      requestOptions: { timeout: requestTimeoutMs },
    });
    const c = new VaultClient(client, opts);
    await c.startTokenRenew();
    return c;
  }

  /** Read a single field from a KV-v2 secret. */
  async read<T = string>(path: string, field: string): Promise<Secret<T>> {
    const fullPath = `${this.kvMount}/data/${path}`;
    try {
      const res = (await this.vault.read(fullPath)) as { data: { data: Record<string, unknown> } };
      const value = res.data.data[field];
      if (value === undefined) {
        throw new Errors.VigilError({
          code: 'VAULT_FIELD_MISSING',
          message: `Field '${field}' missing from ${fullPath}`,
          severity: 'error',
        });
      }
      return wrapSecret(value as T);
    } catch (e) {
      // Tier-25 audit closure: log err_name/err_message instead of the
      // raw error object. node-vault's error responses can include the
      // upstream Vault body, which may carry secret-derived context;
      // structured fields avoid serialising attacker-influenced payloads
      // and match the T13/T15/T16/T17/T19/T21 convention.
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        { err_name: err.name, err_message: err.message, path: fullPath, field },
        'vault-read-failed',
      );
      throw e instanceof Errors.VigilError
        ? e
        : new Errors.VigilError({
            code: 'VAULT_READ_FAILED',
            message: `Vault read failed: ${fullPath}/${field}`,
            severity: 'error',
            cause: e,
          });
    }
  }

  /** Write a KV-v2 secret. */
  async write(path: string, data: Record<string, unknown>): Promise<void> {
    const fullPath = `${this.kvMount}/data/${path}`;
    await this.vault.write(fullPath, { data });
    this.logger.info({ path: fullPath }, 'vault-write-ok');
  }

  /** Issue a short-lived child token with a specific policy — used for service-to-service. */
  async issueChildToken(opts: {
    policies: readonly string[];
    ttl: string;
    renewable?: boolean;
  }): Promise<Secret<string>> {
    const res = (await this.vault.tokenCreate({
      policies: [...opts.policies],
      ttl: opts.ttl,
      renewable: opts.renewable ?? true,
      no_parent: true,
    })) as { auth: { client_token: string } };
    return wrapSecret(res.auth.client_token);
  }

  /** Issue a PKI cert from `pki/internal/issue/<role>` — used by mTLS bootstrap. */
  async issueCertificate(opts: {
    role: string;
    commonName: string;
    altNames?: string;
    ttl?: string;
  }): Promise<{ certificate: string; privateKey: Secret<string>; caChain: string }> {
    const path = `${process.env.VAULT_PKI_MOUNT ?? 'pki/internal'}/issue/${opts.role}`;
    const res = (await this.vault.write(path, {
      common_name: opts.commonName,
      alt_names: opts.altNames,
      ttl: opts.ttl ?? '24h',
      format: 'pem',
    })) as { data: { certificate: string; private_key: string; ca_chain: string[] } };
    return {
      certificate: res.data.certificate,
      privateKey: wrapSecret(res.data.private_key),
      caChain: res.data.ca_chain.join('\n'),
    };
  }

  /** Begin auto-renewing the auth token. */
  private async startTokenRenew(): Promise<void> {
    try {
      const info = (await this.vault.tokenLookupSelf()) as {
        data: { ttl: number; renewable: boolean };
      };
      if (!info.data.renewable) return;
      // Renew at 50% of TTL
      const interval = Math.max(60_000, info.data.ttl * 500);
      this.renewTimer = setInterval(() => {
        void this.renewToken();
      }, interval);
      this.renewTimer.unref();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.warn(
        { err_name: err.name, err_message: err.message },
        'vault-token-lookup-failed',
      );
    }
  }

  private async renewToken(): Promise<void> {
    try {
      await this.vault.tokenRenewSelf();
      this.consecutiveRenewFailures = 0;
      this.logger.debug('vault-token-renewed');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.consecutiveRenewFailures += 1;
      this.logger.error(
        {
          err_name: err.name,
          err_message: err.message,
          consecutive_failures: this.consecutiveRenewFailures,
        },
        'vault-token-renew-failed',
      );
      // AUDIT-058: increment a counter so an alert can fire on
      // sustained failures (a worker silently outliving its token
      // TTL would otherwise look like a Vault outage from the
      // dashboard hours later).
      const service = process.env.OTEL_SERVICE_NAME ?? 'unknown';
      vaultTokenRenewFailedTotal.labels({ service }).inc();
      // Tier-25 audit closure: after MAX_CONSECUTIVE_RENEW_FAILURES,
      // emit a fatal-level log so the on-call alert fires BEFORE the
      // first secret-using path 403s. We deliberately do not exit the
      // process here — the worker owner decides the escalation policy
      // (some workers can degrade gracefully on a stale token; others
      // can't). The fatal log + the AUDIT-058 counter both surface;
      // the alertmanager rule on vault_token_renew_failed_total >= 5
      // already covers the operational threshold.
      if (this.consecutiveRenewFailures >= VaultClient.MAX_CONSECUTIVE_RENEW_FAILURES) {
        this.logger.fatal(
          {
            consecutive_failures: this.consecutiveRenewFailures,
            threshold: VaultClient.MAX_CONSECUTIVE_RENEW_FAILURES,
          },
          'vault-token-renew-exhausted; worker holding stale token',
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.renewTimer) clearInterval(this.renewTimer);
  }
}
