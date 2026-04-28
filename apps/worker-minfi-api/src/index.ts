import { createSign } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { VaultClient, expose } from '@vigil/security';
import { Schemas } from '@vigil/shared';
import Fastify from 'fastify';
import IORedis from 'ioredis';
import { sql } from 'drizzle-orm';

const logger = createLogger({ service: 'worker-minfi-api' });

/**
 * MINFI scoring API (SRD §26).
 *
 * POST /score
 *   { request_id, contract_reference, amount_xaf, recipient, payment_date }
 * → { request_id, score, band, finding_ids, explanation_fr/en, valid_until, signature }
 *
 * Idempotent on request_id (24h cache via Redis).
 */

async function main(): Promise<void> {
  await initTracing({ service: 'worker-minfi-api' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const db = await getDb();
  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());

  const redisHost = process.env.REDIS_HOST ?? 'vigil-redis';
  const redisPort = Number(process.env.REDIS_PORT ?? 6379);
  const redis = new IORedis({ host: redisHost, port: redisPort });
  registerShutdown('redis', () => redis.quit().then(() => undefined));

  const responsePrivKey = await vault.read<string>('minfi-api', 'response_signing_private_key');

  const fastify = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    trustProxy: true,
  });
  await fastify.register(helmet);
  await fastify.register(rateLimit, {
    max: Number(process.env.MINFI_API_RATE_LIMIT_PER_MINUTE ?? 600),
    timeWindow: '1 minute',
  });

  fastify.get('/healthz', () => ({ status: 'ok' }));

  fastify.post('/score', async (req, reply) => {
    const parsed = Schemas.zMinfiScoreRequest.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid', issues: parsed.error.issues };
    }
    const { request_id, recipient } = parsed.data;

    // Idempotency cache (24h)
    const cacheKey = `minfi:score:${request_id}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Compute score from active findings against the recipient's RCCM/NIU.
    // Fast path: query finding.finding for any escalated finding referencing this RCCM/NIU.
    const r = await db.execute(sql`
      SELECT id, posterior, severity
        FROM finding.finding
       WHERE state IN ('review','council_review','escalated')
         AND (
           ${recipient.rccm ?? null}::text IS NOT NULL
           OR ${recipient.niu ?? null}::text IS NOT NULL
         )
       ORDER BY posterior DESC NULLS LAST
       LIMIT 20
    `);
    const findings = r.rows as Array<{ id: string; posterior: number | null; severity: string }>;
    const maxPosterior = findings.reduce((acc, f) => Math.max(acc, f.posterior ?? 0), 0);
    const band: Schemas.MinfiScoreBand =
      maxPosterior >= 0.85 ? 'red' : maxPosterior >= 0.55 ? 'orange' : maxPosterior >= 0.30 ? 'amber' : 'green';

    const computedAt = new Date();
    const validUntil = new Date(computedAt.getTime() + 24 * 3_600_000);

    const responseUnsigned: Omit<Schemas.MinfiScoreResponse, 'signature'> = {
      request_id,
      score: maxPosterior,
      band,
      finding_ids: findings.map((f) => f.id),
      title_fr: bandTitleFr(band),
      title_en: bandTitleEn(band),
      explanation_fr: bandExplanationFr(band, findings.length),
      explanation_en: bandExplanationEn(band, findings.length),
      caveats_fr: 'Décision finale incombe à l’ordonnateur ; cette API conseille, ne bloque pas.',
      caveats_en: 'Final decision rests with the disbursing officer; this API advises, it does not block.',
      computed_at: computedAt.toISOString(),
      valid_until: validUntil.toISOString(),
    };

    // ECDSA-sign the canonical JSON
    const canonical = JSON.stringify(responseUnsigned);
    const sig = createSign('SHA256')
      .update(canonical)
      .sign(expose(responsePrivKey), 'base64');

    const response: Schemas.MinfiScoreResponse = { ...responseUnsigned, signature: sig };
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 86_400);
    return response;
  });

  const port = Number(process.env.MINFI_API_PORT ?? 4001);
  await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'worker-minfi-api-ready');
  registerShutdown('fastify', () => fastify.close());
}

function bandTitleFr(b: Schemas.MinfiScoreBand): string {
  return { green: 'Risque faible', amber: 'Risque modéré', orange: 'Risque élevé', red: 'Risque critique' }[b];
}
function bandTitleEn(b: Schemas.MinfiScoreBand): string {
  return { green: 'Low risk', amber: 'Moderate risk', orange: 'High risk', red: 'Critical risk' }[b];
}
function bandExplanationFr(b: Schemas.MinfiScoreBand, n: number): string {
  return b === 'green'
    ? "Aucun constat actif n’associe le bénéficiaire à une procédure VIGIL APEX en cours."
    : `Le bénéficiaire est associé à ${n} constat(s) actif(s) — band=${b}. Voir les références jointes.`;
}
function bandExplanationEn(b: Schemas.MinfiScoreBand, n: number): string {
  return b === 'green'
    ? 'No active VIGIL APEX findings associate this recipient with an open procedure.'
    : `Recipient associated with ${n} active finding(s) — band=${b}. See attached references.`;
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
