import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { DossierRepo, getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { VaultClient, expose } from '@vigil/security';
import { Schemas } from '@vigil/shared';
import { create as kuboCreate } from 'kubo-rpc-client';
import SftpClient from 'ssh2-sftp-client';
import { z } from 'zod';

import { buildManifest, type FormatAdapterVersion } from './format-adapter.js';

const logger = createLogger({ service: 'worker-conac-sftp' });

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.startsWith('PLACEHOLDER')) {
    throw new Error(
      `${name} is unset or PLACEHOLDER; refusing to ship dossier with incomplete signer manifest`,
    );
  }
  return v;
}

function requireGpgFingerprint(): string {
  const v = process.env.GPG_FINGERPRINT;
  if (!v || v.startsWith('PLACEHOLDER') || !/^[0-9A-Fa-f]{40}$/.test(v.replace(/\s+/g, ''))) {
    throw new Error(
      'GPG_FINGERPRINT is unset, PLACEHOLDER, or not a 40-hex-char OpenPGP fingerprint; CONAC manifests cannot ship unsigned',
    );
  }
  return v.replace(/\s+/g, '').toUpperCase();
}

const zPayload = z.object({
  finding_id: z.string().uuid(),
  dossier_ref: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  pdf_cid: z.string(),
  pdf_sha256: z.string().length(64),
  language: z.enum(['fr', 'en']),
});
type Payload = z.infer<typeof zPayload>;

interface FetchedPdf {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly cid: string;
}

class ConacSftpWorker extends WorkerBase<Payload> {
  constructor(
    private readonly vault: VaultClient,
    private readonly dossierRepo: DossierRepo,
    private readonly ipfsApiUrl: string,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-conac-sftp',
      stream: STREAMS.DOSSIER_DELIVER,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 1, // sequential to avoid SFTP-session conflicts
      maxRetries: 8,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const formatVersion: FormatAdapterVersion =
      (process.env.CONAC_FORMAT_ADAPTER as FormatAdapterVersion) ?? 'v1';

    if (process.env.CONAC_SFTP_HOST?.startsWith('PLACEHOLDER')) {
      logger.warn('CONAC_SFTP_HOST not provisioned; queueing dossier for later delivery');
      return { kind: 'retry', reason: 'conac-not-provisioned', delay_ms: 24 * 3_600_000 };
    }

    // Both language dossiers must be present before delivery (SRD §25 — bilingual
    // dossier is a single deliverable). Look up siblings; if not yet rendered,
    // back off until worker-dossier finishes the other language.
    const siblings = await this.dossierRepo.listByFinding(env.payload.finding_id);
    const fr = siblings.find((d) => d.language === 'fr');
    const en = siblings.find((d) => d.language === 'en');
    if (!fr || !en || !fr.pdf_cid || !en.pdf_cid) {
      logger.info(
        { finding_id: env.payload.finding_id, has_fr: !!fr, has_en: !!en },
        'awaiting-bilingual-pair',
      );
      return { kind: 'retry', reason: 'awaiting-sibling-language', delay_ms: 60_000 };
    }

    let frPdf: FetchedPdf;
    let enPdf: FetchedPdf;
    try {
      [frPdf, enPdf] = await Promise.all([
        this.fetchAndVerify(fr.pdf_cid, fr.pdf_sha256),
        this.fetchAndVerify(en.pdf_cid, en.pdf_sha256),
      ]);
    } catch (err) {
      logger.error({ err, ref: env.payload.dossier_ref }, 'ipfs-fetch-failed');
      return { kind: 'retry', reason: 'ipfs-fetch-failed', delay_ms: 60_000 };
    }

    const sftp = new SftpClient();
    try {
      const privKey = await this.vault.read<string>('conac-sftp', 'private_key');
      await sftp.connect({
        host: process.env.CONAC_SFTP_HOST!,
        port: Number(process.env.CONAC_SFTP_PORT ?? 22),
        username: process.env.CONAC_SFTP_USER ?? 'vigilapex',
        privateKey: expose(privKey),
        readyTimeout: 30_000,
        algorithms: {
          kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org'],
          cipher: ['chacha20-poly1305@openssh.com', 'aes256-gcm@openssh.com'],
          serverHostKey: ['ssh-ed25519', 'rsa-sha2-512'],
        },
      });

      const inbox = process.env.CONAC_INBOX ?? '/inbox/vigil-apex';
      const ackDir = process.env.CONAC_ACK_DIR ?? '/ack/vigil-apex';
      const ref = env.payload.dossier_ref;

      // Build manifest via format-adapter (W-25) — now with REAL bytes + sha256
      const manifest = buildManifest(
        {
          dossier: {
            id: env.payload.finding_id,
            ref,
            finding_id: env.payload.finding_id,
            language: env.payload.language,
            status: 'rendered',
            pdf_sha256: env.payload.pdf_sha256 as Schemas.Sha256Hex,
            pdf_cid: env.payload.pdf_cid as Schemas.DocumentCid,
            signature_fingerprint: null,
            signature_at: null,
            rendered_at: new Date().toISOString(),
            delivered_at: null,
            acknowledged_at: null,
            recipient_case_reference: null,
            manifest_hash: null,
            metadata: {},
          },
          finding: { id: env.payload.finding_id } as unknown as Schemas.Finding,
          fr_pdf: { sha256: frPdf.sha256, bytes: frPdf.bytes.length },
          en_pdf: { sha256: enPdf.sha256, bytes: enPdf.bytes.length },
          evidence_archive: { sha256: '0'.repeat(64), bytes: 0 },
          signer: {
            name: requiredEnv('SIGNER_NAME'),
            pgp_fingerprint: requireGpgFingerprint(),
            signed_at: new Date().toISOString(),
          },
          audit_anchor: { audit_event_id: 'pending', polygon_tx_hash: null },
        },
        formatVersion,
      );

      // Upload PDFs FIRST, manifest LAST (SRD §25.3 — manifest is the
      // "ready to ingest" trigger; partial uploads must not look complete).
      const remoteDir = `${inbox}/${ref}`;
      await sftp.mkdir(remoteDir, true);
      await sftp.put(frPdf.bytes, `${remoteDir}/${ref}-fr.pdf`);
      await sftp.put(enPdf.bytes, `${remoteDir}/${ref}-en.pdf`);

      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
      const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
      await sftp.put(manifestBytes, `${remoteDir}/${ref}-manifest.json`);

      // Persist delivery state for both language rows.
      await Promise.all([
        this.dossierRepo.markDelivered(fr.id, manifestHash),
        this.dossierRepo.markDelivered(en.id, manifestHash),
      ]);

      // Poll for ACK (5-min interval, up to 7 days per SRD §25.4)
      const ackPath = `${ackDir}/${ref}.ack`;
      const start = Date.now();
      while (Date.now() - start < 7 * 86_400_000) {
        try {
          const exists = await sftp.exists(ackPath);
          if (exists === '-') {
            const ackBytes = (await sftp.get(ackPath)) as Buffer;
            const parsed = Schemas.zConacAck.safeParse(JSON.parse(ackBytes.toString('utf8')));
            if (parsed.success) {
              const conacRef = parsed.data.conac_case_reference;
              await Promise.all([
                this.dossierRepo.markAcknowledged(fr.id, conacRef),
                this.dossierRepo.markAcknowledged(en.id, conacRef),
              ]);
              logger.info({ ref, conac_ref: conacRef }, 'conac-ack-received');
              return { kind: 'ack' };
            }
          }
        } catch {
          // ignore transient errors, retry
        }
        await sleep(5 * 60_000);
      }
      return { kind: 'retry', reason: 'no-ack-7d', delay_ms: 24 * 3_600_000 };
    } catch (e) {
      logger.error({ err: e }, 'sftp-failed');
      return { kind: 'retry', reason: 'sftp-error', delay_ms: 60_000 };
    } finally {
      await sftp.end().catch(() => null);
    }
  }

  /**
   * Fetch a CID's bytes from the local Kubo node, concatenate, hash, and
   * verify against the dossier row's recorded sha256. A mismatch is fatal —
   * either the IPFS payload was tampered with or the dossier row's sha256
   * is wrong; both demand human review.
   */
  private async fetchAndVerify(cid: string, expectedSha256: string): Promise<FetchedPdf> {
    const kubo = kuboCreate({ url: this.ipfsApiUrl });
    const chunks: Uint8Array[] = [];
    for await (const chunk of kubo.cat(cid)) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(
        `ipfs-sha256-mismatch: cid=${cid} expected=${expectedSha256} actual=${sha256}`,
      );
    }
    return { bytes, sha256, cid };
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-conac-sftp' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const dossierRepo = new DossierRepo(db);
  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());

  const ipfsApiUrl = process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001';

  const worker = new ConacSftpWorker(vault, dossierRepo, ipfsApiUrl, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-conac-sftp-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
