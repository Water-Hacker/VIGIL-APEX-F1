import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { StaticKeyResolver, type KeyResolver } from '@vigil/federation-stream';

import type { Logger } from '@vigil/observability';

/**
 * DirectoryKeyResolver — boot-time scan of a directory of PEM files.
 *
 * Each file is named `<REGION>:<rotation_seq>.pem` (matching the
 * signing_key_id convention used by 13-vault-pki-federation.sh + R10).
 * The file contents are the ed25519 public-key PEM (SPKI form, the
 * format `crypto.createPublicKey()` accepts).
 *
 * This is the *scaffold* implementation. The live VaultPkiKeyResolver
 * (M2 follow-up) will replace this with an HTTP client that pulls
 * `pki-region-<code>/cert/<serial>` from the per-region Vault
 * subordinate at startup and refreshes on a TTL, but that requires
 * runtime-issued regional Vault subordinates (post-cutover, R9).
 *
 * Today, the architect populates the directory by hand during the
 * per-region cutover ceremony — copying the cert from
 * /run/vigil/region-cas/<CODE>.cert.pem into
 * /run/vigil/secrets/region-pubkeys/<CODE>:1.pem after extracting the
 * SPKI public key.
 */
export class DirectoryKeyResolver implements KeyResolver {
  private readonly inner = new StaticKeyResolver();

  constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<number> {
    const entries = await readdir(this.directory).catch(() => [] as string[]);
    let loaded = 0;
    for (const name of entries) {
      if (!name.endsWith('.pem')) continue;
      const keyId = basename(name, '.pem');
      const pem = await readFile(join(this.directory, name), 'utf8');
      this.inner.register(keyId, pem);
      loaded += 1;
    }
    this.logger.info({ directory: this.directory, loaded }, 'federation-key-resolver-loaded');
    return loaded;
  }

  resolve(signingKeyId: string): string | null {
    return this.inner.resolve(signingKeyId);
  }
}

/**
 * Stub for the live VaultPkiKeyResolver. Documents the intended
 * interface so the M2 follow-up has a concrete shape to fill in.
 *
 * Rationale: not implemented today because the per-region Vault
 * subordinates are bootstrap-only (K3) until the per-region cutover
 * ceremony brings them online (R9). Without runtime-issued
 * subordinates, the HTTP client has nothing to talk to. The fallback
 * — DirectoryKeyResolver — meets the architect's needs for the
 * scaffold close.
 *
 * When implementing, the URL pattern is:
 *   <vault_addr>/v1/pki-region-<lower(region)>/cert/<serial>
 * with the architect's policy token. Cache PEM by signing_key_id with
 * a 1h TTL, fall through to a CRL check on miss, and treat a CRL
 * positive as "revoked" (return null).
 */
export class VaultPkiKeyResolver implements KeyResolver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resolve(_signingKeyId: string): null {
    throw new Error('VaultPkiKeyResolver is not implemented yet — use DirectoryKeyResolver');
  }
}
