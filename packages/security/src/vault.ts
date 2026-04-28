import { readFile } from 'node:fs/promises';

import { createLogger, type Logger } from '@vigil/observability';
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
    const client = nodeVault({
      apiVersion: 'v1',
      endpoint: addr,
      token,
      namespace: namespace ?? undefined,
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
      this.logger.error({ err: e, path: fullPath, field }, 'vault-read-failed');
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
      this.logger.warn({ err: e }, 'vault-token-lookup-failed');
    }
  }

  private async renewToken(): Promise<void> {
    try {
      await this.vault.tokenRenewSelf();
      this.logger.debug('vault-token-renewed');
    } catch (e) {
      this.logger.error({ err: e }, 'vault-token-renew-failed');
    }
  }

  async close(): Promise<void> {
    if (this.renewTimer) clearInterval(this.renewTimer);
  }
}
