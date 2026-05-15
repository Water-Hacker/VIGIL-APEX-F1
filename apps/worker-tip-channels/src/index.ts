import { HashChain } from '@vigil/audit-chain';
import { TipRepo, getDb, getPool } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';
import { QueueClient, STREAMS, WorkerBase, type Envelope, type HandlerOutcome } from '@vigil/queue';
import { VaultClient, expose } from '@vigil/security';

import { handleTipChannelsEvent, zTipChannelsPayload, type TipChannelsPayload } from './handler.js';

const logger = createLogger({ service: 'worker-tip-channels' });

/**
 * worker-tip-channels — FRONTIER-AUDIT Layer-1 E1.4 closure.
 *
 * Consumes inbound USSD / SMS / voice tip descriptors from
 * STREAMS.TIP_CHANNELS_INCOMING. The telecom-gateway webhook bridge
 * (Caddy + per-operator HMAC verification, deployed separately) is
 * what converts MTN / Orange operator-specific webhook payloads into
 * the canonical `TipChannelsPayload` shape and writes them onto the
 * stream.
 *
 * Per envelope this worker:
 *   1. Reassembles USSD multi-segments / validates voice confidence.
 *   2. Sealed-box encrypts the plaintext against the council pubkey
 *      (libsodium X25519 + XChaCha20-Poly1305 — byte-identical to the
 *      browser-side libsodium output, so triage cannot distinguish
 *      channel from ciphertext alone).
 *   3. Allocates a `TIP-YYYY-NNNN` reference via the same per-year
 *      counter used by the browser portal.
 *   4. Persists via TipRepo.insert; the DB-level append-only trigger
 *      (migration 0011) prevents row deletion outside the court-order
 *      redact path.
 *   5. Emits an `audit.tip_received_channel` chain row carrying only
 *      channel, language, ciphertext byte length, gateway request id,
 *      and correlation id. Plaintext + MSISDN are NEVER on the chain.
 *
 * Plaintext is dropped from memory immediately after step 2; the
 * MSISDN never reaches this worker.
 */

class TipChannelsWorker extends WorkerBase<TipChannelsPayload> {
  constructor(
    private readonly tipRepo: TipRepo,
    private readonly chain: HashChain,
    private readonly councilPublicKeyB64: string,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-tip-channels',
      stream: STREAMS.TIP_CHANNELS_INCOMING,
      schema: zTipChannelsPayload,
      client: queue,
      logger,
      concurrency: 2,
    });
  }

  protected async handle(env: Envelope<TipChannelsPayload>): Promise<HandlerOutcome> {
    return handleTipChannelsEvent(
      {
        tipRepo: this.tipRepo,
        chain: this.chain,
        councilPublicKeyB64: this.councilPublicKeyB64,
        logger,
      },
      env,
    );
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-tip-channels' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const db = await getDb();
  const pool = await getPool();
  const tipRepo = new TipRepo(db);
  const chain = new HashChain(pool, logger);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  // Council pubkey is the same one the browser tip portal serves at
  // /api/tip/public-key — published by the operator-team Vault entry so
  // browser, USSD gateway, SMS gateway, and IVR encrypt against an
  // identical key. Triage decrypt via 3-of-5 Shamir share recovery is
  // therefore channel-agnostic.
  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const councilPublicKeySecret = await vault.read<string>('tip-operator-team', 'public_key_b64');
  const councilPublicKeyB64 = expose(councilPublicKeySecret);
  if (!councilPublicKeyB64 || councilPublicKeyB64.startsWith('PLACEHOLDER')) {
    throw new Error(
      'worker-tip-channels: TIP_OPERATOR_TEAM_PUBKEY missing or placeholder; refusing to start',
    );
  }

  const worker = new TipChannelsWorker(tipRepo, chain, councilPublicKeyB64, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info({ stream: STREAMS.TIP_CHANNELS_INCOMING }, 'worker-tip-channels-ready');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
