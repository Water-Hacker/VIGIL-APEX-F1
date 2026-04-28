import { readFile } from 'node:fs/promises';

import { createLogger, type Logger } from '@vigil/observability';
import neo4j, { Driver, ManagedTransaction, Session } from 'neo4j-driver';

export interface Neo4jClientOptions {
  readonly uri?: string;
  readonly user?: string;
  readonly passwordFile?: string;
  readonly password?: string;
  readonly database?: string;
  readonly logger?: Logger;
}

export class Neo4jClient {
  public readonly driver: Driver;
  private readonly database: string;
  private readonly logger: Logger;

  private constructor(driver: Driver, database: string, logger: Logger) {
    this.driver = driver;
    this.database = database;
    this.logger = logger;
  }

  static async connect(opts: Neo4jClientOptions = {}): Promise<Neo4jClient> {
    const logger = opts.logger ?? createLogger({ service: 'db-neo4j' });
    let password = opts.password;
    if (!password) {
      const file = opts.passwordFile ?? process.env.NEO4J_PASSWORD_FILE;
      if (!file) throw new Error('NEO4J_PASSWORD_FILE required');
      password = (await readFile(file, 'utf8')).trim();
    }
    const driver = neo4j.driver(
      opts.uri ?? process.env.NEO4J_URI ?? 'bolt://vigil-neo4j:7687',
      neo4j.auth.basic(opts.user ?? process.env.NEO4J_USER ?? 'neo4j', password),
      {
        maxConnectionPoolSize: Number(process.env.NEO4J_MAX_CONN_POOL_SIZE ?? 50),
        connectionTimeout: Number(process.env.NEO4J_CONN_TIMEOUT_MS ?? 30_000),
        disableLosslessIntegers: true,
      },
    );
    return new Neo4jClient(driver, opts.database ?? process.env.NEO4J_DATABASE ?? 'vigil', logger);
  }

  session(): Session {
    return this.driver.session({ database: this.database });
  }

  async run<T = Record<string, unknown>>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const session = this.session();
    try {
      const r = await session.run(query, params);
      return r.records.map((rec) => rec.toObject() as T);
    } finally {
      await session.close();
    }
  }

  async writeTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.session();
    try {
      return session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  async readTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.session();
    try {
      return session.executeRead(work);
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  /** Bootstrap constraints + indexes; idempotent. SRD §8.2. */
  async bootstrapSchema(): Promise<void> {
    const queries = [
      'CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE',
      'CREATE CONSTRAINT person_rccm IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE',
      'CREATE CONSTRAINT company_rccm IF NOT EXISTS FOR (n:Company) REQUIRE n.id IS UNIQUE',
      'CREATE CONSTRAINT project_id IF NOT EXISTS FOR (n:Project) REQUIRE n.id IS UNIQUE',
      'CREATE INDEX entity_name IF NOT EXISTS FOR (n:Entity) ON (n.display_name)',
      'CREATE INDEX entity_pep IF NOT EXISTS FOR (n:Entity) ON (n.is_pep, n.is_sanctioned)',
      'CREATE INDEX rel_kind IF NOT EXISTS FOR ()-[r:RELATED_TO]-() ON (r.kind)',
    ];
    for (const q of queries) {
      try {
        await this.run(q);
      } catch (e) {
        this.logger.warn({ err: e, q }, 'neo4j-bootstrap-skip');
      }
    }
  }
}
