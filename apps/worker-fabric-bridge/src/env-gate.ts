/**
 * Tier-13 audit closure — env-gate helpers extracted from index.ts so the
 * production-default refusal logic + cert pre-flight is unit-testable.
 *
 * The risk being mitigated:
 *   - In a real multi-org Fabric deployment, silently falling back to
 *     `Org1MSP` and `vigil-fabric-peer0-org1:7051` would either fail
 *     opaquely at endorse time or — worse — submit witnesses against
 *     the wrong MSP.
 *   - Missing TLS/cert files surface as a generic "PEM read failed"
 *     deep inside the gRPC handshake; at boot we want a clear message
 *     naming the offending env var.
 */
import { existsSync } from 'node:fs';

export interface FabricEnvResolved {
  mspId: string;
  peerEndpoint: string;
  tlsRootCertPath: string;
  clientCertPath: string;
  clientPrivateKeyPath: string;
}

export function isProductionLike(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production' || nodeEnv === 'staging';
}

export function resolveFabricEnv(
  env: NodeJS.ProcessEnv,
  fsExists: (p: string) => boolean = existsSync,
): FabricEnvResolved {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const productionLike = isProductionLike(nodeEnv);

  const requireExplicit = (name: string): string => {
    const v = env[name];
    if (!v || v.trim() === '') {
      throw new Error(
        `${name} is required in NODE_ENV=${nodeEnv}; refusing to start worker-fabric-bridge with development defaults`,
      );
    }
    return v;
  };

  const mspId = productionLike
    ? requireExplicit('FABRIC_MSP_ID')
    : (env.FABRIC_MSP_ID ?? 'Org1MSP');
  const peerEndpoint = productionLike
    ? requireExplicit('FABRIC_PEER_ENDPOINT')
    : (env.FABRIC_PEER_ENDPOINT ?? 'vigil-fabric-peer0-org1:7051');

  const tlsRootCertPath = env.FABRIC_TLS_ROOT ?? '/run/secrets/fabric_tls_root';
  const clientCertPath = env.FABRIC_CLIENT_CERT ?? '/run/secrets/fabric_client_cert';
  const clientPrivateKeyPath = env.FABRIC_CLIENT_KEY ?? '/run/secrets/fabric_client_key';

  for (const [name, path] of [
    ['FABRIC_TLS_ROOT', tlsRootCertPath],
    ['FABRIC_CLIENT_CERT', clientCertPath],
    ['FABRIC_CLIENT_KEY', clientPrivateKeyPath],
  ] as const) {
    if (!fsExists(path)) {
      throw new Error(
        `${name}=${JSON.stringify(path)} does not exist on disk; refusing to start worker-fabric-bridge`,
      );
    }
  }

  return { mspId, peerEndpoint, tlsRootCertPath, clientCertPath, clientPrivateKeyPath };
}
