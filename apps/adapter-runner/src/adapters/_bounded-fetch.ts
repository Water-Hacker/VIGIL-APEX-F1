/**
 * Bounded undici fetch helpers — adapter-local re-export.
 *
 * The implementation moved to `@vigil/observability/bounded-fetch`
 * (AUDIT-095 closure) so cross-package consumers (workers, scripts)
 * can use the same code without deep-importing into adapter-runner.
 *
 * This file is kept as a re-export so existing imports continue to
 * work without churn. New call sites should prefer importing from
 * `@vigil/observability` directly.
 */
export {
  boundedBodyJson,
  boundedBodyText,
  boundedRequest,
  BOUNDED_BODY_MAX_BYTES,
  BOUNDED_FETCH_BODY_TIMEOUT_MS,
  BOUNDED_FETCH_HEADERS_TIMEOUT_MS,
  type BoundedRequestOptions,
} from '@vigil/observability';
