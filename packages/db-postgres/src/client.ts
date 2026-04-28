import { readFile } from 'node:fs/promises';

import { createLogger, type Logger } from '@vigil/observability';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

/**
 * Pooled Postgres client. Per SRD §07: tuned with statement_timeout,
 * lock_timeout, and idle_in_transaction_session_timeout to bound damage from
 * runaway queries.
 */

export type Db = NodePgDatabase<typeof schema>;

export interface DbClientOptions {
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
  readonly passwordFile?: string;
  readonly password?: string;
  readonly poolMin?: number;
  readonly poolMax?: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly idleInTxTimeoutMs?: number;
  readonly sslMode?: 'disable' | 'require' | 'verify-full';
  readonly sslRootCertPath?: string;
  readonly logger?: Logger;
}

let singletonPool: Pool | null = null;

export async function createPool(opts: DbClientOptions = {}): Promise<Pool> {
  const logger = opts.logger ?? createLogger({ service: 'db-postgres' });

  let password = opts.password;
  if (password === undefined && opts.passwordFile) {
    password = (await readFile(opts.passwordFile, 'utf8')).trim();
  } else if (password === undefined && process.env.POSTGRES_PASSWORD_FILE) {
    password = (await readFile(process.env.POSTGRES_PASSWORD_FILE, 'utf8')).trim();
  }

  let ssl: PoolConfig['ssl'] = false;
  const mode = opts.sslMode ?? (process.env.POSTGRES_SSLMODE as DbClientOptions['sslMode']);
  if (mode === 'verify-full') {
    const root = opts.sslRootCertPath ?? process.env.POSTGRES_SSLROOTCERT;
    if (!root) throw new Error('POSTGRES_SSLROOTCERT required for verify-full');
    ssl = { ca: await readFile(root, 'utf8'), rejectUnauthorized: true };
  } else if (mode === 'require') {
    ssl = { rejectUnauthorized: false };
  }

  const cfg: PoolConfig = {
    connectionString: opts.url ?? process.env.POSTGRES_URL,
    host: opts.host ?? process.env.POSTGRES_HOST ?? 'vigil-postgres',
    port: opts.port ?? Number(process.env.POSTGRES_PORT ?? 5432),
    database: opts.database ?? process.env.POSTGRES_DB ?? 'vigil',
    user: opts.user ?? process.env.POSTGRES_USER ?? 'vigil',
    ...(password !== undefined && { password }),
    min: opts.poolMin ?? Number(process.env.POSTGRES_POOL_MIN ?? 2),
    max: opts.poolMax ?? Number(process.env.POSTGRES_POOL_MAX ?? 20),
    statement_timeout: opts.statementTimeoutMs ?? Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS ?? 30_000),
    query_timeout: opts.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: 60_000,
    application_name: 'vigil-apex',
    ssl,
  };
  const pool = new Pool(cfg);
  pool.on('error', (e) => logger.error({ err: e }, 'pg-pool-error'));
  pool.on('connect', (client) => {
    void client.query(
      `SET lock_timeout = ${opts.lockTimeoutMs ?? 5000};
       SET idle_in_transaction_session_timeout = ${opts.idleInTxTimeoutMs ?? 60_000};`,
    );
  });
  return pool;
}

export async function getPool(opts?: DbClientOptions): Promise<Pool> {
  if (singletonPool) return singletonPool;
  singletonPool = await createPool(opts);
  return singletonPool;
}

export async function getDb(opts?: DbClientOptions): Promise<Db> {
  const pool = await getPool(opts);
  return drizzle(pool, { schema });
}

export async function closePool(): Promise<void> {
  if (singletonPool) {
    await singletonPool.end();
    singletonPool = null;
  }
}
