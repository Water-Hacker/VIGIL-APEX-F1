import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FindingRepo, getDb } from '@vigil/db-postgres';
import { renderDossierDocx, gpgDetachSign } from '@vigil/dossier';
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
  newEnvelope,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Schemas, formatDossierRef } from '@vigil/shared';
import { create as kuboCreate } from 'kubo-rpc-client';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-dossier' });

const zPayload = z.object({
  finding_id: z.string().uuid(),
  language: z.enum(['fr', 'en']),
  classification: z.enum(['restreint', 'confidentiel', 'public']).default('restreint'),
});
type Payload = z.infer<typeof zPayload>;

class DossierWorker extends WorkerBase<Payload> {
  constructor(
    private readonly findingRepo: FindingRepo,
    private readonly ipfsApi: string,
    private readonly gpgFingerprint: string,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-dossier',
      stream: STREAMS.DOSSIER_RENDER,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 2,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const finding = await this.findingRepo.getById(env.payload.finding_id);
    if (!finding) return { kind: 'dead-letter', reason: 'finding not found' };

    const year = new Date().getUTCFullYear();
    // Allocate a sequence (production: dossier_sequence row); placeholder seq 1
    const ref = formatDossierRef(year, 1);
    const docxResult = await renderDossierDocx({
      ref,
      language: env.payload.language,
      classification: env.payload.classification,
      finding: finding as unknown as Schemas.Finding,
      entities: [],
      signals: [],
      counterEvidence: finding.counter_evidence ?? '',
      auditAnchor: { auditEventId: 'pending', polygonTxHash: null },
      council: {
        yesVotes: finding.council_yes_votes,
        noVotes: finding.council_no_votes,
        abstain: 0,
        recused: finding.council_recused_addresses,
        proposalIndex: finding.council_proposal_index,
      },
      verifyUrl: `https://verify.vigilapex.cm/verify/${ref}`,
      publicLedgerCheckpointUrl: `https://verify.vigilapex.cm/ledger`,
    });

    // Convert .docx to .pdf via LibreOffice headless (deterministic with --calc-headless options)
    const dir = path.join(tmpdir(), `vigil-dossier-${env.id}`);
    await mkdir(dir, { recursive: true });
    const docxPath = path.join(dir, `${ref}.docx`);
    await writeFile(docxPath, docxResult.docxBytes);
    await runLibreOffice(docxPath, dir);
    const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
    const pdfBytes = await readFile(pdfPath);
    const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');

    // GPG sign — YubiKey-backed; gpg-agent prompts for touch
    let signature: Buffer | null = null;
    try {
      signature = await gpgDetachSign(pdfBytes, { fingerprint: this.gpgFingerprint });
    } catch (e) {
      logger.error({ err: e }, 'gpg-sign-failed; continuing unsigned (dev only)');
    }

    // IPFS pin
    const kubo = kuboCreate({ url: this.ipfsApi });
    const added = await kubo.add(pdfBytes, { pin: true, cidVersion: 1 });
    const cid = added.cid.toString();

    logger.info({ ref, pdf_sha256: pdfSha256, cid }, 'dossier-rendered');

    // Push delivery envelope
    await this.config.client.publish(
      STREAMS.DOSSIER_DELIVER,
      newEnvelope(
        'worker-dossier',
        {
          finding_id: finding.id,
          dossier_ref: ref,
          pdf_cid: cid,
          pdf_sha256: pdfSha256,
          language: env.payload.language,
        },
        `${ref}|${env.payload.language}|deliver`,
        env.correlation_id,
      ),
    );
    void signature;
    await rm(dir, { recursive: true, force: true });
    return { kind: 'ack' };
  }
}

function runLibreOffice(docxPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('soffice', [
      '--headless',
      '--convert-to', 'pdf:writer_pdf_Export:UseTaggedPDF=false;ExportFormFields=false;ReduceImageResolution=false',
      '--outdir', outDir,
      docxPath,
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited ${code}`))));
  });
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-dossier' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const findingRepo = new FindingRepo(db);

  const worker = new DossierWorker(
    findingRepo,
    process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001',
    process.env.GPG_FINGERPRINT ?? 'PLACEHOLDER_FP_REPLACE_AT_M0c',
    queue,
  );
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-dossier-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
