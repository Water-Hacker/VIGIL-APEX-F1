import { defineConfig } from 'drizzle-kit';

if (!process.env.POSTGRES_URL) {
  throw new Error(
    'POSTGRES_URL is unset. Drizzle migrations refuse to run without an explicit target — set POSTGRES_URL before invoking drizzle-kit so a misfire never silently hits a localhost dev DB.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_SSLMODE === 'verify-full' ? { rejectUnauthorized: true } : false,
  },
  schemaFilter: ['source', 'entity', 'finding', 'dossier', 'governance', 'audit', 'tip', 'calibration'],
  verbose: true,
  strict: true,
});
