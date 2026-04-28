import * as Sentry from '@sentry/nextjs';

/**
 * Sentry/GlitchTip browser SDK init (Phase C16).
 *
 * The DSN is taken from `NEXT_PUBLIC_SENTRY_DSN`; if absent (e.g. local
 * dev), the SDK no-ops. Sample rate 100% on errors, 10% on traces — the
 * traffic on operator surfaces is small enough that we keep every error.
 *
 * `vigil_correlation_id` cookie is forwarded as a tag so backend
 * structured logs (E5) can be joined with frontend Sentry events.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_DEPLOY_ENV ?? 'production',
    release: process.env.NEXT_PUBLIC_RELEASE,
    // Strip URL params that may carry tip refs / personal identifiers
    beforeSend(event) {
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          u.searchParams.delete('ref');
          u.searchParams.delete('token');
          event.request.url = u.toString();
        } catch {
          /* ignore */
        }
      }
      return event;
    },
  });
}
