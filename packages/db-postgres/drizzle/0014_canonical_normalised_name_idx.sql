-- @migration-locks-acknowledged: shipped before mode 2.5 closure; the index is fast in practice because entity.canonical was small at deployment. The next index added against entity.canonical (post-this-migration) MUST use CONCURRENTLY — see scripts/check-migration-locks.ts.
-- Block-A reconciliation §2.A.7 / original A.7 — expression index
-- supporting the rule-pass exact-match lookup in
-- EntityRepo.findCanonicalByNormalizedName.
--
-- The current trgm index `canonical_name_trgm` on display_name (GIN
-- with gin_trgm_ops) supports LIKE/ILIKE/% similarity searches but
-- cannot be used for `WHERE expr = $1`. The rule-pass query is an
-- exact-equality lookup against the normalised expression below;
-- without this index Postgres falls through to a sequential scan on
-- entity.canonical for every alias the rule-pass tries to match by
-- name. At Phase-1 scale (~10k entities) tolerable; at Phase-2 scale
-- (10^5+) catastrophic.
--
-- The expression below MUST match the JS-side normalisation in
-- EntityRepo.findCanonicalByNormalizedName byte-for-byte. If the SQL
-- expression drifts, the planner stops using the index AND the
-- lookup returns wrong rows.
--
-- Plain CREATE INDEX (not CONCURRENTLY) per the project convention
-- in 0002_perf_indexes.sql — the deploy runner re-runs with
-- CONCURRENTLY based on $POSTGRES_INDEX_CONCURRENT in production.

CREATE INDEX IF NOT EXISTS canonical_display_name_normalised_idx
  ON entity.canonical
  ((regexp_replace(
       lower(translate(display_name,
         'àáâäãåèéêëìíîïòóôöõùúûüñçÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÑÇ',
         'aaaaaaeeeeiiiioooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
       '[^a-z0-9 ]', ' ', 'g'
     )));
