-- Down-migration for 0014_canonical_normalised_name_idx.sql
DROP INDEX IF EXISTS entity.canonical_display_name_normalised_idx;
