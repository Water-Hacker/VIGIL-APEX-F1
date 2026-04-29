import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FederationStreamClient,
  FederationStreamServer,
  StaticKeyResolver,
  type EventEnvelope,
  type HealthBeaconReply,
  type HealthBeaconRequest,
  type ReceiverHandlers,
} from '@vigil/federation-stream';

/**
 * Free-port grabber. Bind a server to :0, read the chosen port, close it.
 * gRPC then re-binds the same port — there's a tiny race window but in
 * practice the OS reuses TIME_WAIT'd numbers very rarely on localhost.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no port')));
      }
    });
    srv.on('error', reject);
  });
}

function ed25519PemPair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

interface AcceptedRecord {
  envelopeId: string;
  region: string;
  sourceId: string;
  observedAtMs: number;
}

class CapturingHandlers implements ReceiverHandlers {
  readonly accepted: AcceptedRecord[] = [];
  // Tracks last observed_at per region for the beacon reply.
  private readonly lastObserved = new Map<string, number>();

  async onAccepted(env: EventEnvelope): Promise<void> {
    this.accepted.push({
      envelopeId: env.envelopeId,
      region: env.region,
      sourceId: env.sourceId,
      observedAtMs: env.observedAtMs,
    });
    this.lastObserved.set(env.region, env.observedAtMs);
  }

  async onBeacon(req: HealthBeaconRequest): Promise<HealthBeaconReply> {
    return {
      lastObservedAtMs: this.lastObserved.get(req.region) ?? 0,
      coreNowMs: Date.now(),
      throttleHintMs: 0,
    };
  }
}

describe('federation-stream end-to-end (in-process, insecure)', () => {
  let server: FederationStreamServer;
  let client: FederationStreamClient;
  let handlers: CapturingHandlers;
  let port: number;

  // Two keypairs: the "real" CE key the client signs with, plus a
  // second keypair we register under the SAME key id as a tamper test
  // (so verification fails because the resolver returns a key that
  // doesn't match the signature).
  let realKeys: ReturnType<typeof ed25519PemPair>;
  let tmpDir: string;
  let signingKeyPath: string;

  beforeAll(async () => {
    // The federation-stream server refuses to start without TLS unless
    // this opt-in is set (see packages/federation-stream/src/server.ts §207).
    // In-process tests run plaintext gRPC on localhost; production deploys
    // never set this.
    process.env['VIGIL_FEDERATION_INSECURE_OK'] = 'true';

    realKeys = ed25519PemPair();
    tmpDir = mkdtempSync(join(tmpdir(), 'federation-stream-test-'));
    signingKeyPath = join(tmpDir, 'signer.key');
    writeFileSync(signingKeyPath, realKeys.privatePem, { mode: 0o400 });

    const resolver = new StaticKeyResolver();
    resolver.register('CE:1', realKeys.publicPem);

    handlers = new CapturingHandlers();
    port = await freePort();

    server = new FederationStreamServer({
      listenAddress: `127.0.0.1:${port}`,
      keyResolver: resolver,
      handlers,
    });
    await server.start();

    client = new FederationStreamClient({
      coreEndpoint: `127.0.0.1:${port}`,
      region: 'CE',
      signingKeyId: 'CE:1',
      signingPrivateKeyPath: signingKeyPath,
      // batch quickly so the test doesn't wait the full 2s default
      batchSize: 10,
      batchIntervalMs: 50,
    });
    client.start();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it('round-trips 50 signed envelopes and forwards each to the receiver handler', async () => {
    const baseTs = Date.now();
    const promises = Array.from({ length: 50 }, (_, i) =>
      client.push({
        envelopeId: `01928c66-7e1f-7000-9000-${String(i).padStart(12, '0')}`,
        region: 'CE',
        sourceId: 'integration-test',
        dedupKey: `dedup-${i}`,
        payload: Buffer.from(`event-${i}`, 'utf8'),
        observedAtMs: baseTs + i,
      }),
    );

    // Drain — close the stream so the server's `end` callback fires.
    // The client's batch timer will flush before close anyway.
    const acks = await Promise.all(promises);
    // Every promise resolves with the *same* batch ack containing this
    // envelope's id. Across all promises, the union of `accepted` ids
    // must cover all 50 envelopes.
    const acceptedAcrossBatches = new Set<string>();
    for (const ack of acks) for (const id of ack.accepted) acceptedAcrossBatches.add(id);
    expect(acceptedAcrossBatches.size).toBe(50);

    // The handler must have been invoked once per envelope.
    expect(handlers.accepted.length).toBe(50);
    expect(new Set(handlers.accepted.map((a) => a.envelopeId)).size).toBe(50);
    expect(handlers.accepted.every((a) => a.region === 'CE')).toBe(true);
  }, 30_000);

  it('beacon round-trips and reports the most recent observed_at_ms', async () => {
    const reply = await client.beacon({ agentNowMs: Date.now(), agentSeqTotal: 50 });
    expect(reply.coreNowMs).toBeGreaterThan(0);
    expect(reply.lastObservedAtMs).toBeGreaterThan(0);
    expect(reply.throttleHintMs).toBe(0);
  });

  it('rejects envelopes whose signature does not match the resolver-published key', async () => {
    // Spin up a *second* client with a fresh signing private key but the
    // same key id as the server's resolver expects. The resolver's
    // pubkey for "CE:1" is `realKeys.publicPem`, but this client signs
    // with a different private key — every envelope must be rejected
    // with SIGNATURE_INVALID.
    const wrong = ed25519PemPair();
    const wrongKeyPath = join(tmpDir, 'wrong-signer.key');
    writeFileSync(wrongKeyPath, wrong.privatePem, { mode: 0o400 });

    const tamperClient = new FederationStreamClient({
      coreEndpoint: `127.0.0.1:${port}`,
      region: 'CE',
      signingKeyId: 'CE:1',
      signingPrivateKeyPath: wrongKeyPath,
      batchSize: 4,
      batchIntervalMs: 50,
    });
    tamperClient.start();
    try {
      const acks = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          tamperClient.push({
            envelopeId: `tamper-${i}`,
            region: 'CE',
            sourceId: 'tamper-test',
            dedupKey: `tamper-dedup-${i}`,
            payload: Buffer.from('would-be-event', 'utf8'),
            observedAtMs: Date.now(),
          }),
        ),
      );
      const allRejected = new Set<string>();
      for (const ack of acks) {
        for (const r of ack.rejected) {
          expect(r.code).toBe('SIGNATURE_INVALID');
          allRejected.add(r.envelopeId);
        }
      }
      expect(allRejected.size).toBe(4);
    } finally {
      await tamperClient.close();
    }
  }, 15_000);
});
