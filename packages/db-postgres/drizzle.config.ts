import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      'postgres://vigil:vigil@localhost:5432/vigil',
    ssl: process.env.POSTGRES_SSLMODE === 'verify-full' ? { rejectUnauthorized: true } : false,
  },
  schemaFilter: ['source', 'entity', 'finding', 'dossier', 'governance', 'audit', 'tip', 'calibration'],
  verbose: true,
  strict: true,
});
