import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HashChain } from '@vigil/audit-chain';
import { DossierRepo, EntityRepo, FindingRepo, getDb, getPool } from '@vigil/db-postgres';
import { renderDossierDocx, gpgDetachSign } from '@vigil/dossier';
import {
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  startRedisStreamScraper,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Ids, Schemas } from '@vigil/shared';
import { create as kuboCreate } from 'kubo-rpc-client';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-dossier' });

const zPayload = z.object({
  finding_id: z.string().uuid(),
  language: z.enum(['fr', 'en']),
  classification: z.enum(['restreint', 'confidentiel', 'public']).default('restreint'),
  /** DECISION-010 — required from worker-governance, optional only for legacy
   *  Phase-0 envelopes. Defaults to CONAC for back-compat. */
  recipient_body_name: z
    .enum(['CONAC', 'COUR_DES_COMPTES', 'MINFI', 'ANIF', 'CDC', 'OTHER'])
    .default('CONAC'),
  proposal_index: z.string().optional(),
});
type Payload = z.infer<typeof zPayload>;

function rowToCanonical(
  row: NonNullable<Awaited<ReturnType<EntityRepo['getCanonical']>>>,
): Schemas.EntityCanonical {
  return {
    id: row.id,
    kind: row.kind as Schemas.EntityCanonical['kind'],
    display_name: row.display_name,
    rccm_number: row.rccm_number,
    niu: row.niu,
    jurisdiction: row.jurisdiction,
    region: row.region as Schemas.EntityCanonical['region'],
    eth_address: row.eth_address as Schemas.EntityCanonical['eth_address'],
    is_pep: row.is_pep,
    is_sanctioned: row.is_sanctioned,
    sanctioned_lists: row.sanctioned_lists,
    first_seen: row.first_seen.toISOString(),
    last_seen: row.last_seen.toISOString(),
    resolution_confidence: row.resolution_confidence,
    resolved_by: row.resolved_by as Schemas.EntityCanonical['resolved_by'],
    metadata: (row.metadata as Schemas.EntityCanonical['metadata']) ?? {},
  };
}

function rowToSignal(row: Awaited<ReturnType<FindingRepo['getSignals']>>[number]): Schemas.Signal {
  return {
    id: row.id,
    finding_id: row.finding_id,
    source: row.source as Schemas.Signal['source'],
    pattern_id: row.pattern_id as Schemas.Signal['pattern_id'],
    strength: row.strength,
    prior: row.prior,
    weight: row.weight,
    evidence_event_ids: row.evidence_event_ids,
    evidence_document_cids: row.evidence_document_cids,
    contributed_at: row.contributed_at.toISOString(),
    metadata: row.metadata as Record<string, unknown>,
  };
}

class DossierWorker extends WorkerBase<Payload> {
  constructor(
    private readonly findingRepo: FindingRepo,
    private readonly dossierRepo: DossierRepo,
    private readonly entityRepo: EntityRepo,
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

    // Load entities (primary + related) and signals in parallel.
    const entityIds = [
      ...(finding.primary_entity_id ? [finding.primary_entity_id] : []),
      ...finding.related_entity_ids,
    ];
    const [entityRows, signalRows] = await Promise.all([
      entityIds.length > 0
        ? this.entityRepo.getCanonicalMany(entityIds)
        : Promise.resolve([] as Awaited<ReturnType<EntityRepo['getCanonicalMany']>>),
      this.findingRepo.getSignals(finding.id),
    ]);
    const entities = entityRows.map(rowToCanonical);
    const signals = signalRows.map(rowToSignal);

    const year = new Date().getUTCFullYear();
    const seq = await this.dossierRepo.nextSeq(year);
    const ref = Ids.formatDossierRef(year, seq);

    const findingForRender = {
      ...finding,
      detected_at: finding.detected_at.toISOString(),
      last_signal_at: finding.last_signal_at.toISOString(),
      council_voted_at: finding.council_voted_at ? finding.council_voted_at.toISOString() : null,
      closed_at: finding.closed_at ? finding.closed_at.toISOString() : null,
    } as unknown as Schemas.Finding;

    const docxResult = await renderDossierDocx({
      ref,
      language: env.payload.language,
      classification: env.payload.classification,
      finding: findingForRender,
      entities,
      signals,
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
      recipientBody: env.payload.recipient_body_name,
    });

    // Convert .docx to .pdf via LibreOffice headless (deterministic with --calc-headless options)
    // AUDIT-039 — defense-in-depth path-traversal guard. env.id and ref are
    // both UUIDs / formatted refs by construction (Ids.formatDossierRef +
    // queue envelope id), so this guard never trips today; if a refactor
    // ever lets a `..` or `/` through, the spawn(soffice,...) call below
    // would otherwise be the first thing to notice.
    const safeEnvId = path.basename(env.id);
    const safeRef = path.basename(ref);
    if (safeEnvId !== env.id || safeRef !== ref) {
      throw new Error(`dossier path component contains a separator: env.id=${env.id} ref=${ref}`);
    }
    const dir = path.join(tmpdir(), `vigil-dossier-${safeEnvId}`);
    // Tier-58 audit closure — wrap the rest of the handler in try/finally so
    // the tmp dir is removed on EVERY exit path (success, throw, retry).
    // Pre-fix, the `rm(dir)` call lived after the dossier-row insert + the
    // queue.publish; any throw between mkdir and rm leaked the dir until
    // worker restart. Over time the leak accumulated mode-0600 PDFs in
    // /tmp; not catastrophic but unbounded.
    await mkdir(dir, { recursive: true });
    try {
      const docxPath = path.join(dir, `${safeRef}.docx`);
      await writeFile(docxPath, docxResult.docxBytes);
      await runLibreOffice(docxPath, dir);
      const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
      const pdfBytes = await readFile(pdfPath);
      // Tier-58 audit closure — hard cap on PDF size. LibreOffice can produce
      // pathologically large PDFs under font-fallback or embedded-image bugs;
      // a 100 MB PDF would OOM the worker and stall the IPFS pin. 50 MiB is
      // generous for a real bilingual dossier (typical: 200-500 KiB).
      const MAX_PDF_BYTES = 50 * 1024 * 1024;
      if (pdfBytes.byteLength > MAX_PDF_BYTES) {
        throw new Error(
          `LibreOffice produced an oversized PDF: ${pdfBytes.byteLength} bytes > cap ${MAX_PDF_BYTES}`,
        );
      }
      const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');

      // GPG sign — YubiKey-backed; gpg-agent prompts for touch.
      // Production discipline: an unsigned dossier breaks chain-of-custody for
      // CONAC delivery + Polygon anchor. We refuse to write the row unless
      // signing succeeds, EXCEPT when the operator has explicitly opted into
      // the dev fallback. The opt-in is scoped to non-production phases only.
      let signature: Buffer;
      let signatureFingerprint: string;
      try {
        signature = await gpgDetachSign(pdfBytes, { fingerprint: this.gpgFingerprint });
        signatureFingerprint = this.gpgFingerprint;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const devUnsignedAllowed =
          process.env.VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER === 'true' &&
          process.env.NODE_ENV !== 'production' &&
          Number(process.env.VIGIL_PHASE ?? '0') < 1;
        if (!devUnsignedAllowed) {
          logger.error(
            { err_name: err.name, err_message: err.message },
            'gpg-sign-failed; refusing to write unsigned dossier',
          );
          return { kind: 'retry', reason: 'gpg-sign-failed', delay_ms: 60_000 };
        }
        logger.warn(
          { err_name: err.name, err_message: err.message },
          'gpg-sign-failed; continuing UNSIGNED — VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER opt-in',
        );
        signature = Buffer.alloc(0);
        signatureFingerprint = `DEV-UNSIGNED-${this.gpgFingerprint}`;
      }

      // IPFS pin
      const kubo = kuboCreate({ url: this.ipfsApi });
      const added = await kubo.add(pdfBytes, { pin: true, cidVersion: 1 });
      const cid = added.cid.toString();

      // Persist dossier row — sibling worker-conac-sftp reads this by finding_id
      // to discover both language variants before delivery.
      const signed = signature.length > 0;
      await this.dossierRepo.insert({
        id: randomUUID(),
        ref,
        finding_id: finding.id,
        language: env.payload.language,
        status: 'rendered',
        pdf_sha256: pdfSha256,
        pdf_cid: cid,
        signature_fingerprint: signed ? signatureFingerprint : signatureFingerprint, // dev fallback prefixes "DEV-UNSIGNED-" so downstream can detect
        signature_at: signed ? new Date() : null,
        rendered_at: new Date(),
        delivered_at: null,
        acknowledged_at: null,
        recipient_body_name: env.payload.recipient_body_name,
        recipient_case_reference: null,
        manifest_hash: null,
        metadata: {
          classification: env.payload.classification,
          content_hash: docxResult.contentHash,
          entity_count: entities.length,
          signal_count: signals.length,
          proposal_index: env.payload.proposal_index ?? null,
        },
      });

      logger.info(
        { ref, pdf_sha256: pdfSha256, cid, entities: entities.length, signals: signals.length },
        'dossier-rendered',
      );

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
            recipient_body_name: env.payload.recipient_body_name,
          },
          `${ref}|${env.payload.language}|deliver`,
          env.correlation_id,
        ),
      );
      void signature;
      return { kind: 'ack' };
    } finally {
      // Tier-58: cleanup on EVERY exit path (success, throw, retry).
      // best-effort — a leaked tmpdir is operationally harmless, but
      // logging the failure helps catch a /tmp-permission regression.
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(
          { err_name: err.name, err_message: err.message, dir },
          'dossier-tmp-cleanup-failed',
        );
      }
    }
  }
}

/**
 * Tier-12 council-dossier audit closure: hard wall-clock cap on the
 * LibreOffice headless convert. Pre-fix the spawn had no timeout — a
 * hung soffice (font fallback loop, X server vestige, libreoffice
 * background sync) would block the dossier worker indefinitely. With
 * `concurrency: 2`, two hung renders would stall the entire dossier
 * pipeline.
 *
 * 90 s is generous for any realistic dossier (typical render: 3–8 s,
 * 95th percentile on heavily-formatted bilingual docs: ~20 s). Anything
 * above that cap is presumed pathological; kill the child + reject so
 * the worker retries on the queue with a fresh process.
 */
const LIBREOFFICE_TIMEOUT_MS = Number(process.env.LIBREOFFICE_TIMEOUT_MS ?? 90_000);

function runLibreOffice(docxPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('soffice', [
      '--headless',
      '--convert-to',
      'pdf:writer_pdf_Export:UseTaggedPDF=false;ExportFormFields=false;ReduceImageResolution=false',
      '--outdir',
      outDir,
      docxPath,
    ]);
    // Tier-58 audit closure — capture stderr so non-zero exit codes
    // carry the soffice diagnostic message into the operator log.
    // Pre-fix, the reject error was just "soffice exited N" with no
    // signal about WHY (missing font, corrupt docx, fontconfig misuse).
    // Bound the capture at 4 KB so a verbose-mode soffice can't blow
    // up worker memory.
    const STDERR_CAP_BYTES = 4096;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < STDERR_CAP_BYTES) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, LIBREOFFICE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stderrPreview = Buffer.concat(stderrChunks).toString('utf8').slice(0, STDERR_CAP_BYTES);
      if (timedOut) {
        reject(
          new Error(
            `soffice exceeded ${LIBREOFFICE_TIMEOUT_MS}ms timeout (SIGKILLed); stderr: ${stderrPreview || '<empty>'}`,
          ),
        );
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`soffice exited ${code}; stderr: ${stderrPreview || '<empty>'}`));
    });
  });
}

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-dossier', logger });
  await guard.check();

  await initTracing({ service: 'worker-dossier' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const scraper = startRedisStreamScraper(queue, {
    streams: [STREAMS.DOSSIER_DELIVER],
    logger,
  });
  registerShutdown('redis-stream-scraper', () => scraper.stop());

  const db = await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-dossier',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-dossier', emit });

  const findingRepo = new FindingRepo(db);
  const dossierRepo = new DossierRepo(db);
  const entityRepo = new EntityRepo(db);

  const gpgFingerprint = process.env.GPG_FINGERPRINT;
  if (
    !gpgFingerprint ||
    gpgFingerprint.startsWith('PLACEHOLDER') ||
    !/^[0-9A-Fa-f]{40}$/.test(gpgFingerprint.replace(/\s+/g, ''))
  ) {
    throw new Error(
      'GPG_FINGERPRINT is unset, PLACEHOLDER, or not a valid 40-hex OpenPGP fingerprint; refusing to start worker-dossier',
    );
  }
  const worker = new DossierWorker(
    findingRepo,
    dossierRepo,
    entityRepo,
    process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001',
    gpgFingerprint.replace(/\s+/g, '').toUpperCase(),
    queue,
  );
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info('worker-dossier-ready');
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
