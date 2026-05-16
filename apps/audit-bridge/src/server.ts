import { existsSync, mkdirSync } from 'node:fs';
import { chmod, unlink } from 'node:fs/promises';
import path from 'node:path';

import { HashChain } from '@vigil/audit-chain';
import { getPool } from '@vigil/db-postgres';
import { type Logger } from '@vigil/observability';
import { Schemas } from '@vigil/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

const zAppendBody = z.object({
  action: Schemas.zAuditAction,
  actor: z.string().min(1).max(200),
  subject_kind: z.enum([
    'system',
    'finding',
    'dossier',
    'proposal',
    'member',
    'tip',
    'document',
    'adapter',
    'calibration_entry',
    'decision',
    'phase',
  ]),
  subject_id: z.string().min(1).max(200),
  payload: z.record(z.unknown()).default({}),
});

export interface AuditBridgeServer {
  readonly app: FastifyInstance;
  readonly socketPath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AuditBridgeOptions {
  readonly logger: Logger;
  readonly socketPath: string;
}

export async function createAuditBridgeServer(
  opts: AuditBridgeOptions,
): Promise<AuditBridgeServer> {
  const dir = path.dirname(opts.socketPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o770 });
  }
  // Remove stale socket if any.
  if (existsSync(opts.socketPath)) {
    await unlink(opts.socketPath);
  }

  // Tier-9 audit closure: cap request body at 64 KB. The /append route
  // accepts arbitrary `payload: z.record(z.unknown())`; fastify's default
  // bodyLimit is 1 MB but no audit-row payload should be anywhere near
  // that. A pathologically large payload slows canonical.ts hashing AND
  // bloats the audit row. 64 KB is generous for legitimate use.
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  app.get('/health', async () => ({ ok: true }));

  app.post('/append', async (req, reply) => {
    const parsed = zAppendBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid-body', details: parsed.error.flatten() };
    }
    try {
      const pool = await getPool();
      const chain = new HashChain(pool, opts.logger);
      const result = await chain.append({
        action: parsed.data.action,
        actor: parsed.data.actor,
        subject_kind: parsed.data.subject_kind,
        subject_id: parsed.data.subject_id,
        payload: parsed.data.payload,
      });
      return {
        id: result.id,
        seq: String(result.seq),
        body_hash: result.body_hash,
        prev_hash: result.prev_hash,
        occurred_at: result.occurred_at,
      };
    } catch (err) {
      // Tier-9 audit closure: don't echo raw error message in the HTTP
      // response. The caller is UDS-local and the message is rarely
      // actionable from their side; full err goes to the structured
      // log where operators can correlate by request time. Opaque
      // `append-failed` plus a request-correlation timestamp suffices
      // for the caller.
      const errNorm = err instanceof Error ? err : new Error(String(err));
      opts.logger.error(
        { err_name: errNorm.name, err_message: errNorm.message },
        'audit-bridge-append-failed',
      );
      reply.code(500);
      return { error: 'append-failed' };
    }
  });

  return {
    app,
    socketPath: opts.socketPath,
    async start() {
      await app.listen({ path: opts.socketPath });
      // Tier-9 audit closure: explicitly chmod the UDS socket to 0o660
      // (owner+group rw, no world). Default UDS perms vary by OS; on
      // Linux fastify creates the socket with 0o755 (world-readable
      // file metadata, though only mode-0o600+ processes can connect).
      // The audit-bridge accepts arbitrary audit-event appends — only
      // the vigil-system group should reach it.
      try {
        await chmod(opts.socketPath, 0o660);
      } catch (err) {
        // Non-fatal — if chmod fails (e.g. tmpfs that ignores mode),
        // surface a warn so operators can chase it. The socket is
        // still gated by the parent directory's 0o770 mode set above.
        opts.logger.warn(
          { err, socketPath: opts.socketPath },
          'audit-bridge-socket-chmod-failed; relying on parent-dir perms',
        );
      }
      opts.logger.info({ socketPath: opts.socketPath }, 'audit-bridge-listening');
    },
    async stop() {
      await app.close();
      // AUDIT-014 — log the unlink failure at info level instead of
      // swallowing silently. Permission errors / stale-socket cleanup
      // races are uncommon enough that they should leave a trail; an
      // operator restarting the bridge should be able to see why a
      // subsequent start might fail with EADDRINUSE.
      try {
        if (existsSync(opts.socketPath)) await unlink(opts.socketPath);
      } catch (err) {
        opts.logger.info({ err, socketPath: opts.socketPath }, 'audit-bridge-socket-unlink-failed');
      }
    },
  };
}
