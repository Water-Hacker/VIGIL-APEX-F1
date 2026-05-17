import { createLogger } from '@vigil/observability';
import { type NextRequest } from 'next/server';

import { listAlerts, type AlertRow } from '../../../../lib/alerts.server';
import { startSseHeartbeat } from '../../../../lib/sse-heartbeat';

const logger = createLogger({ service: 'api-alerts-stream' });

/**
 * GET /api/alerts/stream — Server-Sent Events for the operator
 * /alerts page (Concern B in the R3 build).
 *
 * Unlike the general `/api/realtime` fan-out (which forwards a
 * Redis stream of dashboard-wide events), this endpoint is purpose-
 * built for one resource: rows being inserted into
 * `audit.anomaly_alert`. The client island opens this stream once on
 * mount and prepends every received row to the table.
 *
 * Mechanism: poll `listAlerts({ sinceIso, limit })` every
 * `POLL_MS`. The cursor (`sinceIso`) starts at "now" and advances to
 * the newest `detected_at` we have seen so far, so the steady-state
 * round-trip is O(new-rows). Postgres has a covering index on
 * `(detected_at DESC)` via the table's actor-id-and-detected-at
 * compound index (audit-log schema), so the cost is tiny.
 *
 * Why polling over LISTEN/NOTIFY:
 *   - LISTEN/NOTIFY requires a dedicated long-lived Postgres
 *     connection per SSE subscriber — at N=200 operators connected
 *     simultaneously, that's 200 connections held idle, which dwarfs
 *     our existing pool size.
 *   - 5 s latency is acceptable for the alerts surface (it is not a
 *     trading screen) and matches the operator's natural reaction
 *     time.
 *   - Polling is simpler to reason about under network partition:
 *     missed polls heal naturally on the next tick, whereas a
 *     dropped NOTIFY is silently lost.
 *
 * Heartbeat: every 25 s a `ping` event keeps any intermediary
 * (Caddy, Tor, Cloudflare) from idle-closing the connection.
 *
 * Security: the route is gated by middleware ROUTE_RULES
 * `/api/alerts` (operator/auditor/architect/architect). The
 * `x-vigil-user` belt-and-braces check inside the handler defends
 * against middleware-bypass in dev.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // SSE needs a long-lived connection

const POLL_MS = Number(process.env.VIGIL_ALERTS_STREAM_POLL_MS ?? '5000');
const PAGE_LIMIT = 100;

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-vigil-user');
  if (!userId) {
    return new Response('unauthenticated', { status: 401 });
  }

  const encoder = new TextEncoder();
  const cancelCtrl = new AbortController();
  const cancelSignal = cancelCtrl.signal;

  // Start the SSE cursor at "now" so we only stream rows that arrive
  // AFTER subscription. The initial page render already served the
  // current set.
  let cursorIso = new Date().toISOString();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('event: hello\ndata: {}\n\n'));

      const hb = startSseHeartbeat({
        intervalMs: 25_000,
        signal: cancelSignal,
        onTick: () => {
          if (cancelSignal.aborted) return;
          controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'));
        },
      });

      try {
        while (!cancelSignal.aborted) {
          // Sleep POLL_MS with the cancel signal — avoids holding
          // the request alive past disconnect.
          const slept = await waitOrAbort(POLL_MS, cancelSignal);
          if (!slept) break; // aborted

          let fresh: ReadonlyArray<AlertRow>;
          try {
            fresh = await listAlerts({ sinceIso: cursorIso, limit: PAGE_LIMIT });
          } catch (err) {
            logger.error(
              { errName: (err as Error).name, errMsg: (err as Error).message },
              'alerts-poll-failed',
            );
            // Surface as opaque error to the client; keep the stream open.
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'poll-failed' })}\n\n`),
            );
            continue;
          }

          if (fresh.length === 0) continue;

          // Push oldest-first so the client UI prepends correctly.
          for (let i = fresh.length - 1; i >= 0; i--) {
            const row = fresh[i]!;
            controller.enqueue(encoder.encode(`event: alert\ndata: ${JSON.stringify(row)}\n\n`));
            if (row.detected_at > cursorIso) cursorIso = row.detected_at;
          }
        }
      } catch (err) {
        // Mode 4.9: log server-side; send opaque error to the SSE client.
        logger.error(
          { errName: (err as Error).name, errMsg: (err as Error).message },
          'alerts-sse-error',
        );
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'stream-error' })}\n\n`),
        );
      } finally {
        hb.stop();
        controller.close();
      }
    },
    cancel() {
      cancelCtrl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Promise-resolving sleep that bails early on AbortSignal.
 * Returns true if the timer ran to completion, false if aborted.
 */
function waitOrAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort);
  });
}
