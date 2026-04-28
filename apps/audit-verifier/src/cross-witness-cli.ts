/**
 * One-shot CLI for `make verify-cross-witness` (Phase I1).
 *
 * Walks the full audit chain and exits with:
 *   0 — clean (no missing, no divergent)
 *   2 — Fabric is missing some seqs (bridge backlog or transient)
 *   3 — divergence detected — Postgres and Fabric disagree (P0)
 */
import { getPool } from '@vigil/db-postgres';
import { FabricBridge } from '@vigil/fabric-bridge';
import { createLogger } from '@vigil/observability';

import { verifyCrossWitness } from './cross-witness.js';

const logger = createLogger({ service: 'audit-verifier-cli' });

async function main(): Promise<void> {
  const pool = await getPool();

  const tail = await pool.query<{ max: string | null }>(
    'SELECT MAX(seq)::text AS max FROM audit.actions',
  );
  const tailSeq = BigInt(tail.rows[0]?.max ?? '0');
  if (tailSeq === 0n) {
    logger.info('audit chain empty; nothing to cross-witness');
    process.exit(0);
  }

  const bridge = new FabricBridge(
    {
      mspId: process.env.FABRIC_MSP_ID ?? 'Org1MSP',
      peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'vigil-fabric-peer0-org1:7051',
      ...(process.env.FABRIC_PEER_HOST_ALIAS && {
        peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS,
      }),
      channelName: process.env.FABRIC_CHANNEL ?? 'vigil-audit',
      chaincodeName: process.env.FABRIC_CHAINCODE ?? 'audit-witness',
      tlsRootCertPath: process.env.FABRIC_TLS_ROOT ?? '/run/secrets/fabric_tls_root',
      clientCertPath: process.env.FABRIC_CLIENT_CERT ?? '/run/secrets/fabric_client_cert',
      clientPrivateKeyPath: process.env.FABRIC_CLIENT_KEY ?? '/run/secrets/fabric_client_key',
    },
    logger,
  );
  await bridge.connect();

  const report = await verifyCrossWitness(
    pool,
    bridge,
    { from: 1n, to: tailSeq },
    logger,
  );
  await bridge.close();
  await pool.end();

  if (report.divergentSeqs.length > 0) {
    logger.error({ divergent: report.divergentSeqs }, 'CT-03 FAIL — divergence');
    process.exit(3);
  }
  if (report.missingFromFabric.length > 0) {
    logger.warn(
      { missing_count: report.missingFromFabric.length, sample: report.missingFromFabric.slice(0, 5) },
      'CT-03 WARN — missing seqs in Fabric (bridge backlog?)',
    );
    process.exit(2);
  }
  logger.info({ checked: report.checked }, 'CT-03 OK — no divergence');
  process.exit(0);
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal');
  process.exit(1);
});
