import { createSign, createVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import IORedis from 'ioredis';

const logger = createLogger({ service: 'worker-minfi-api' });

function loadMinfiMtls(): { cert: Buffer; key: Buffer; ca: Buffer; requestCert: true; rejectUnauthorized: true } {
  const certPath = process.env.MINFI_API_TLS_CERT ?? '/run/secrets/minfi_tls_cert';
  const keyPath = process.env.MINFI_API_TLS_KEY ?? '/run/secrets/minfi_tls_key';
  const caPath = process.env.MINFI_API_TLS_CA ?? '/run/secrets/minfi_tls_ca';
  for (const [name, path] of [
    ['MINFI_API_TLS_CERT', certPath],
    ['MINFI_API_TLS_KEY', keyPath],
    ['MINFI_API_TLS_CA', caPath],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(
        `MINFI_API_MTLS=1 but ${name} (${path}) does not exist or is unreadable; refusing to start worker-minfi-api`,
      );
    }
  }
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    ca: readFileSync(caPath),
    requestCert: true,
    rejectUnauthorized: true,
  };
}

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
  // AUTH from /run/secrets/redis_password (B5). Never log the password.
  let redisPassword: string | undefined;
  try {
    redisPassword = readFileSync(
      process.env.REDIS_PASSWORD_FILE ?? '/run/secrets/redis_password',
      'utf8',
    ).trim();
  } catch {
    redisPassword = process.env.REDIS_PASSWORD;
  }
  const redis = new IORedis({
    host: redisHost,
    port: redisPort,
    ...(redisPassword && { password: redisPassword }),
  });
  registerShutdown('redis', () => redis.quit().then(() => undefined));

  const responsePrivKey = await vault.read<string>('minfi-api', 'response_signing_private_key');
  // MINFI's request-signing public key — distributed by MINFI's PKI; we
  // verify each /score request body against the `x-minfi-signature`
  // header before doing any DB work. Rotated quarterly per F10.
  const minfiPublicKeyPem = await vault
    .read<string>('minfi-api', 'minfi_request_public_key')
    .catch(() => null);

  // mTLS — when MINFI_API_MTLS=1 the listener requires a client cert
  // signed by the MINFI CA. Files come from /run/secrets (mounted by
  // the secret-init container at B1).
  const mtlsEnabled = process.env.MINFI_API_MTLS === '1';
  const httpsOptions = mtlsEnabled ? loadMinfiMtls() : null;

  const fastify = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    trustProxy: true,
    ...(httpsOptions && { https: httpsOptions }),
  });
  await fastify.register(helmet);
  await fastify.register(rateLimit, {
    max: Number(process.env.MINFI_API_RATE_LIMIT_PER_MINUTE ?? 600),
    timeWindow: '1 minute',
  });

  fastify.get('/healthz', () => ({ status: 'ok' }));

  fastify.post('/score', async (req, reply) => {
    // Per-request ECDSA P-256 signature over the canonical JSON body
    // (SRD §26.4). MINFI signs with its private key; we verify with
    // the public key fetched from Vault at startup. Header format:
    //   x-minfi-signature: base64(ECDSA-SHA256(canonical_json))
    if (minfiPublicKeyPem) {
      const sigB64 = req.headers['x-minfi-signature'];
      if (typeof sigB64 !== 'string' || sigB64.length === 0) {
        reply.code(401);
        return { error: 'missing-signature' };
      }
      const rawBody = JSON.stringify(req.body);
      const verified = createVerify('SHA256')
        .update(rawBody)
        .verify(expose(minfiPublicKeyPem), sigB64, 'base64');
      if (!verified) {
        reply.code(401);
        return { error: 'invalid-signature' };
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Fail closed in prod — no signature verification path means no
      // way to authenticate the caller and we MUST not score blindly.
      reply.code(503);
      return { error: 'minfi-pubkey-not-provisioned' };
    }

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
    // Resolve recipient identity → canonical entity → active findings where
    // that entity is the primary subject OR appears in related_entity_ids.
    const rccm = recipient.rccm ?? null;
    const niu = recipient.niu ?? null;
    let findings: Array<{ id: string; posterior: number | null; severity: string }> = [];
    if (rccm !== null || niu !== null) {
      const r = await db.execute(sql`
        WITH matched AS (
          SELECT id FROM entity.canonical
           WHERE (${rccm}::text IS NOT NULL AND rccm_number = ${rccm})
              OR (${niu}::text  IS NOT NULL AND niu          = ${niu})
        )
        SELECT f.id, f.posterior, f.severity
          FROM finding.finding f
          JOIN matched m
            ON f.primary_entity_id = m.id
            OR m.id = ANY(f.related_entity_ids)
         WHERE f.state IN ('review','council_review','escalated')
         ORDER BY f.posterior DESC NULLS LAST
         LIMIT 20
      `);
      findings = r.rows as Array<{ id: string; posterior: number | null; severity: string }>;
    }
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
