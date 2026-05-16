import { describe, expect, it } from 'vitest';

import { isProductionLike, resolveFabricEnv } from '../src/env-gate.js';

const alwaysExists = (_p: string): boolean => true;
const neverExists = (_p: string): boolean => false;
const onlyMissing =
  (missing: string) =>
  (p: string): boolean =>
    p !== missing;

describe('isProductionLike', () => {
  it('returns true for "production"', () => {
    expect(isProductionLike('production')).toBe(true);
  });

  it('returns true for "staging"', () => {
    expect(isProductionLike('staging')).toBe(true);
  });

  it('returns false for "development"', () => {
    expect(isProductionLike('development')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isProductionLike(undefined)).toBe(false);
  });

  it('returns false for "test"', () => {
    expect(isProductionLike('test')).toBe(false);
  });
});

describe('resolveFabricEnv — dev defaults', () => {
  it('uses dev MSP and peer defaults when NODE_ENV=development', () => {
    const resolved = resolveFabricEnv(
      { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
      alwaysExists,
    );
    expect(resolved.mspId).toBe('Org1MSP');
    expect(resolved.peerEndpoint).toBe('vigil-fabric-peer0-org1:7051');
  });

  it('uses dev defaults when NODE_ENV is unset (treated as development)', () => {
    const resolved = resolveFabricEnv({} as NodeJS.ProcessEnv, alwaysExists);
    expect(resolved.mspId).toBe('Org1MSP');
    expect(resolved.peerEndpoint).toBe('vigil-fabric-peer0-org1:7051');
  });

  it('honours explicit overrides even in dev', () => {
    const resolved = resolveFabricEnv(
      {
        NODE_ENV: 'development',
        FABRIC_MSP_ID: 'Org42MSP',
        FABRIC_PEER_ENDPOINT: 'peer42.example.org:7051',
      } as NodeJS.ProcessEnv,
      alwaysExists,
    );
    expect(resolved.mspId).toBe('Org42MSP');
    expect(resolved.peerEndpoint).toBe('peer42.example.org:7051');
  });
});

describe('resolveFabricEnv — production refusal', () => {
  it('throws when FABRIC_MSP_ID is missing in production', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'production',
          FABRIC_PEER_ENDPOINT: 'peer.example.org:7051',
        } as NodeJS.ProcessEnv,
        alwaysExists,
      ),
    ).toThrow(/FABRIC_MSP_ID is required in NODE_ENV=production/);
  });

  it('throws when FABRIC_PEER_ENDPOINT is missing in production', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'production',
          FABRIC_MSP_ID: 'OrgRealMSP',
        } as NodeJS.ProcessEnv,
        alwaysExists,
      ),
    ).toThrow(/FABRIC_PEER_ENDPOINT is required in NODE_ENV=production/);
  });

  it('throws when FABRIC_MSP_ID is an empty string in production', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'production',
          FABRIC_MSP_ID: '',
          FABRIC_PEER_ENDPOINT: 'peer.example.org:7051',
        } as NodeJS.ProcessEnv,
        alwaysExists,
      ),
    ).toThrow(/FABRIC_MSP_ID is required/);
  });

  it('throws when FABRIC_PEER_ENDPOINT is whitespace-only in production', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'production',
          FABRIC_MSP_ID: 'OrgRealMSP',
          FABRIC_PEER_ENDPOINT: '   ',
        } as NodeJS.ProcessEnv,
        alwaysExists,
      ),
    ).toThrow(/FABRIC_PEER_ENDPOINT is required/);
  });

  it('throws the same way in staging as in production', () => {
    expect(() =>
      resolveFabricEnv({ NODE_ENV: 'staging' } as NodeJS.ProcessEnv, alwaysExists),
    ).toThrow(/FABRIC_MSP_ID is required in NODE_ENV=staging/);
  });

  it('accepts explicit MSP + peer in production', () => {
    const resolved = resolveFabricEnv(
      {
        NODE_ENV: 'production',
        FABRIC_MSP_ID: 'CONACMSP',
        FABRIC_PEER_ENDPOINT: 'peer0.conac.cm:7051',
      } as NodeJS.ProcessEnv,
      alwaysExists,
    );
    expect(resolved.mspId).toBe('CONACMSP');
    expect(resolved.peerEndpoint).toBe('peer0.conac.cm:7051');
  });
});

describe('resolveFabricEnv — cert pre-flight', () => {
  it('throws when the TLS root cert path does not exist', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'development',
          FABRIC_TLS_ROOT: '/missing/tls-root.pem',
        } as NodeJS.ProcessEnv,
        onlyMissing('/missing/tls-root.pem'),
      ),
    ).toThrow(/FABRIC_TLS_ROOT="\/missing\/tls-root.pem" does not exist on disk/);
  });

  it('throws when the client cert path does not exist', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'development',
          FABRIC_CLIENT_CERT: '/missing/client-cert.pem',
        } as NodeJS.ProcessEnv,
        onlyMissing('/missing/client-cert.pem'),
      ),
    ).toThrow(/FABRIC_CLIENT_CERT="\/missing\/client-cert.pem" does not exist on disk/);
  });

  it('throws when the client private key path does not exist', () => {
    expect(() =>
      resolveFabricEnv(
        {
          NODE_ENV: 'development',
          FABRIC_CLIENT_KEY: '/missing/client-key.pem',
        } as NodeJS.ProcessEnv,
        onlyMissing('/missing/client-key.pem'),
      ),
    ).toThrow(/FABRIC_CLIENT_KEY="\/missing\/client-key.pem" does not exist on disk/);
  });

  it('throws on the default /run/secrets paths when they do not exist', () => {
    expect(() =>
      resolveFabricEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv, neverExists),
    ).toThrow(/FABRIC_TLS_ROOT="\/run\/secrets\/fabric_tls_root" does not exist on disk/);
  });

  it('returns all resolved paths when every cert is present', () => {
    const resolved = resolveFabricEnv(
      {
        NODE_ENV: 'development',
        FABRIC_TLS_ROOT: '/etc/fabric/tls-root.pem',
        FABRIC_CLIENT_CERT: '/etc/fabric/client-cert.pem',
        FABRIC_CLIENT_KEY: '/etc/fabric/client-key.pem',
      } as NodeJS.ProcessEnv,
      alwaysExists,
    );
    expect(resolved.tlsRootCertPath).toBe('/etc/fabric/tls-root.pem');
    expect(resolved.clientCertPath).toBe('/etc/fabric/client-cert.pem');
    expect(resolved.clientPrivateKeyPath).toBe('/etc/fabric/client-key.pem');
  });
});
