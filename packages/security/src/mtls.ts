import { writeFile } from 'node:fs/promises';

import { createLogger, type Logger } from '@vigil/observability';

import { expose } from './secrets.js';
import { VaultClient } from './vault.js';

/**
 * mTLS auto-renew — every container fetches a fresh cert (24h TTL) at start
 * and renews at 50% of TTL. SRD §17.11.
 *
 * The Vault PKI hierarchy (SRD §17.11.1):
 *   pki/root  : self-signed root CA
 *   pki/internal: subordinate CA, used by services
 *
 * Each service is registered as a PKI role with allowed CN patterns.
 */

export interface MtlsConfig {
  readonly serviceName: string;
  readonly commonName: string;
  readonly altNames?: string;
  readonly outputDir: string; // e.g. /run/vigil/certs
  readonly ttl?: string; // e.g. '24h'
  readonly logger?: Logger;
}

export class MtlsManager {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: Logger;
  // AUDIT-066: single-flight mutex preventing concurrent issueAndWrite()
  // calls. The setInterval fires the renewal on a fixed cadence; a
  // misconfiguration that lowered the cadence below the Vault round-
  // trip + disk-write time could otherwise interleave two writes,
  // half-loading the cert. Holding the in-flight Promise here
  // serialises all reloads for the lifetime of the manager.
  private inflightIssue: Promise<void> | null = null;

  constructor(
    private readonly vault: VaultClient,
    private readonly cfg: MtlsConfig,
  ) {
    this.logger = cfg.logger ?? createLogger({ service: `mtls:${cfg.serviceName}` });
  }

  /** Issue + write cert/key/ca to disk; schedule renewal. */
  async start(): Promise<void> {
    await this.requestIssue();
    const ttlSeconds = this.parseTtl(this.cfg.ttl ?? '24h');
    const renewMs = (ttlSeconds * 1000) / 2;
    this.timer = setInterval(() => {
      void this.requestIssue().catch((e) => this.logger.error({ err: e }, 'mtls-renew-failed'));
    }, renewMs);
    this.timer.unref();
    this.logger.info({ renewMs }, 'mtls-renew-scheduled');
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * AUDIT-066: serialise issueAndWrite() through a single-flight
   * Promise. Concurrent callers (the boot start() and a stuck
   * setInterval tick that fires while start() is still in-flight)
   * await the same in-progress reload instead of racing.
   */
  private async requestIssue(): Promise<void> {
    if (this.inflightIssue) return this.inflightIssue;
    const p = (async () => {
      try {
        await this.issueAndWrite();
      } finally {
        this.inflightIssue = null;
      }
    })();
    this.inflightIssue = p;
    return p;
  }

  private async issueAndWrite(): Promise<void> {
    const issued = await this.vault.issueCertificate({
      role: this.cfg.serviceName,
      commonName: this.cfg.commonName,
      ...(this.cfg.altNames !== undefined && { altNames: this.cfg.altNames }),
      ttl: this.cfg.ttl ?? '24h',
    });
    const dir = this.cfg.outputDir;
    await writeFile(`${dir}/${this.cfg.serviceName}.crt`, issued.certificate, { mode: 0o644 });
    await writeFile(`${dir}/${this.cfg.serviceName}.key`, expose(issued.privateKey), {
      mode: 0o600,
    });
    await writeFile(`${dir}/ca.crt`, issued.caChain, { mode: 0o644 });
    this.logger.info({ cn: this.cfg.commonName }, 'mtls-cert-rotated');
  }

  private parseTtl(ttl: string): number {
    const m = /^(\d+)([smhd])$/.exec(ttl);
    if (!m) return 86_400;
    const n = Number(m[1]);
    switch (m[2]) {
      case 's':
        return n;
      case 'm':
        return n * 60;
      case 'h':
        return n * 3600;
      case 'd':
        return n * 86_400;
      default:
        return 86_400;
    }
  }
}
