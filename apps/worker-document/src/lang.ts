import { Schemas } from '@vigil/shared';
import { franc } from 'franc';

/**
 * Map an ISO-639-3 code (franc output) to the `DocumentLanguage` enum
 * stored in `source.documents.language`. Cameroon's primary language is
 * French; Fulfulde and Ewondo are recognised as `unknown` until Phase 2
 * Pulaar / Ewondo adapters land. `und` (undetermined) defaults to French
 * for procurement-flow docs but to `unknown` for structured payloads.
 *
 * Lives in its own module so unit tests don't have to import the
 * worker's main entrypoint (which boots tracing + Redis at module load).
 */
export function detectLanguage(
  text: string | null,
  mime: Schemas.DocumentMime,
): Schemas.DocumentLanguage {
  if (mime === 'application/json' || mime === 'application/xml') return 'unknown';
  if (!text || text.trim().length < 24) {
    return 'fr';
  }
  const code = franc(text, { minLength: 24 });
  switch (code) {
    case 'fra':
      return 'fr';
    case 'eng':
      return 'en';
    case 'ful':
    case 'ewo':
      return 'unknown';
    default:
      return 'fr';
  }
}
