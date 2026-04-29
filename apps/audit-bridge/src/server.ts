import { unlink } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
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

  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post('/append', async (req, reply) => {
    const parsed = zAppendBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid-body', details: parsed.error.flatten() };
    }
    try {
      const pool = await getPool();
      const chain = new HashChain(pool);
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
      opts.logger.error({ err }, 'audit-bridge-append-failed');
      reply.code(500);
      return { error: 'append-failed', message: String(err) };
    }
  });

  return {
    app,
    socketPath: opts.socketPath,
    async start() {
      await app.listen({ path: opts.socketPath });
      opts.logger.info({ socketPath: opts.socketPath }, 'audit-bridge-listening');
    },
    async stop() {
      await app.close();
      try {
        if (existsSync(opts.socketPath)) await unlink(opts.socketPath);
      } catch {
        // ignore
      }
    },
  };
}
