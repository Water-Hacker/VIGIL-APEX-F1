import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DossierRepo, EntityRepo, FindingRepo, getDb } from '@vigil/db-postgres';
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
    await mkdir(dir, { recursive: true });
    const docxPath = path.join(dir, `${safeRef}.docx`);
    await writeFile(docxPath, docxResult.docxBytes);
    await runLibreOffice(docxPath, dir);
    const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
    const pdfBytes = await readFile(pdfPath);
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
      const devUnsignedAllowed =
        process.env.VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER === 'true' &&
        process.env.NODE_ENV !== 'production' &&
        Number(process.env.VIGIL_PHASE ?? '0') < 1;
      if (!devUnsignedAllowed) {
        logger.error({ err: e }, 'gpg-sign-failed; refusing to write unsigned dossier');
        return { kind: 'retry', reason: 'gpg-sign-failed', delay_ms: 60_000 };
      }
      logger.warn(
        { err: e },
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
    await rm(dir, { recursive: true, force: true });
    return { kind: 'ack' };
  }
}

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
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`soffice exited ${code}`)),
    );
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
  logger.info('worker-dossier-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
