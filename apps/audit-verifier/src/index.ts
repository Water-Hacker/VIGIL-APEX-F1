import { setTimeout as sleep } from 'node:timers/promises';

import {
  HashChain,
  PolygonAnchor,
  LedgerVerifier,
  UnixSocketSignerAdapter,
} from '@vigil/audit-chain';
import { getPool } from '@vigil/db-postgres';
import { FabricBridge } from '@vigil/fabric-bridge';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';

import { verifyCrossWitness } from './cross-witness.js';

const logger = createLogger({ service: 'audit-verifier' });

/**
 * audit-verifier — hourly process. Two checks:
 *   CT-01: walk audit.actions [from..to]; verify each row's prev_hash and body_hash.
 *          On break → emit FATAL alert, halt all writes, page architect.
 *   CT-02: read latest VIGILAnchor commitment; verify the local hash chain in
 *          the same range matches.
 */
async function main(): Promise<void> {
  await initTracing({ service: 'audit-verifier' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const signer = new UnixSocketSignerAdapter();
  const polygonContract = process.env.POLYGON_ANCHOR_CONTRACT;
  if (!polygonContract || /^0x0+$/i.test(polygonContract)) {
    throw new Error(
      'POLYGON_ANCHOR_CONTRACT is unset or null-address; refusing to start audit-verifier.',
    );
  }
  const polygonRpcUrl = process.env.POLYGON_RPC_URL;
  if (!polygonRpcUrl) {
    logger.warn('POLYGON_RPC_URL unset; falling back to public polygon-rpc.com');
  }
  const anchor = new PolygonAnchor({
    rpcUrl: polygonRpcUrl ?? 'https://polygon-rpc.com',
    contractAddress: polygonContract,
    signer,
    chainId: Number(process.env.POLYGON_CHAIN_ID ?? 137),
    logger,
  });
  const verifier = new LedgerVerifier(chain, anchor, logger);

  const intervalMs = Number(process.env.AUDIT_VERIFY_INTERVAL_MS ?? 3_600_000);
  let stopping = false;
  registerShutdown('verifier-loop', () => {
    stopping = true;
  });
  logger.info({ intervalMs }, 'audit-verifier-ready');

  // Phase I1 — cross-witness Fabric bridge. Optional: when
  // FABRIC_PEER_ENDPOINT is unset (local dev or pre-G boot), the
  // CT-03 check is skipped without failing the loop.
  const fabricEnabled = Boolean(process.env.FABRIC_PEER_ENDPOINT);
  let bridge: FabricBridge | null = null;
  if (fabricEnabled) {
    bridge = new FabricBridge(
      {
        mspId: process.env.FABRIC_MSP_ID ?? 'Org1MSP',
        peerEndpoint: process.env.FABRIC_PEER_ENDPOINT!,
        ...(process.env.FABRIC_PEER_HOST_ALIAS && {
          peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS,
        }),
        channelName: process.env.FABRIC_CHANNEL ?? 'vigil-audit',
        chaincodeName: process.env.FABRIC_CHAINCODE ?? 'audit-witness',
        tlsRootCertPath: process.env.FABRIC_TLS_ROOT ?? '/run/secrets/fabric_tls_root',
        clientCertPath: process.env.FABRIC_CLIENT_CERT ?? '/run/secrets/fabric_client_cert',
        clientPrivateKeyPath:
          process.env.FABRIC_CLIENT_KEY ?? '/run/secrets/fabric_client_key',
      },
      logger,
    );
    await bridge.connect();
    registerShutdown('fabric-bridge', () => bridge!.close());
  }

  while (!stopping) {
    try {
      // CT-01: full chain walk (cheap; serial scan)
      const tail = await chain.tail();
      if (tail) {
        const verified = await chain.verify(1, tail.seq);
        logger.info({ verified, tail_seq: tail.seq }, 'ct-01-hash-chain-verified');

        // CT-03: cross-witness Fabric ↔ Postgres. Walks the same
        // [1, tail.seq] range that CT-01 just confirmed clean and
        // matches each row against the audit-witness chaincode.
        if (bridge && tail.seq > 0) {
          try {
            const report = await verifyCrossWitness(
              pool,
              bridge,
              { from: 1n, to: BigInt(tail.seq) },
              logger,
            );
            if (report.divergentSeqs.length > 0) {
              logger.error(
                { divergent: report.divergentSeqs },
                'ct-03-cross-witness-divergence',
              );
            } else {
              logger.info(
                { checked: report.checked, missing: report.missingFromFabric.length },
                'ct-03-cross-witness-clean',
              );
            }
          } catch (e) {
            logger.error({ err: e }, 'ct-03-cross-witness-error');
          }
        }
      }
      // CT-02: latest on-chain commitment vs local
      try {
        const r = await verifier.verifyLatest();
        logger.info(r, 'ct-02-ledger-verified');
      } catch (e) {
        logger.error({ err: e }, 'ct-02-mismatch');
      }
    } catch (e) {
      logger.error({ err: e }, 'verifier-loop-error');
    }
    await sleep(intervalMs);
  }
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
