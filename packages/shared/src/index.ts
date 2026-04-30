/**
 * @vigil/shared — root barrel.
 *
 * Foundation package. EVERY other package depends on this. Keep it stable.
 *
 * Per SRD §00.5: types are TypeScript-first via Zod; Postgres tables (Drizzle)
 * are derived from Zod schemas living here.
 */

export * as Schemas from './schemas/index.js';
export * as Errors from './errors/index.js';
export * as Ids from './ids.js';
export * as Time from './time.js';
export * as Money from './money.js';
export * as Constants from './constants.js';
export * as Result from './result.js';
export * as Routing from './routing/index.js';
export * as TipSanitise from './tip-sanitise.js';

export type { Brand, DeepReadonly, Json, JsonObject, Nullable, Optional } from './types.js';
