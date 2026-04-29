import { QueueClient } from '@vigil/queue';
import { type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // SSE needs a long-lived connection — Edge runtime times out

let cachedQueue: QueueClient | null = null;
function queue(): QueueClient {
  if (!cachedQueue) cachedQueue = new QueueClient();
  return cachedQueue;
}

/**
 * GET /api/realtime — Server-Sent Events fan-out (Phase C12).
 *
 * Subscribes to the `vigil:realtime:broadcast` Redis stream and forwards
 * every entry as an SSE message. Workers post here when something
 * dashboard-relevant happens: a new finding crossed the review threshold,
 * a tip arrived, a vote landed. The stream is keyed by topic; the client
 * filters in JS — server fan-out without sticky sessions.
 *
 * Caddy (Phase B) is configured with HTTP/1.1 buffering off for this
 * path; chunked encoding flows straight through.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-vigil-user');
  if (!userId) {
    return new Response('unauthenticated', { status: 401 });
  }

  const encoder = new TextEncoder();
  let lastId = '$'; // start from new entries only
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: hello\ndata: {}\n\n`));

      // Heartbeat every 25s to defeat reverse-proxy idle-timeouts.
      const hb = setInterval(() => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
      }, 25_000);

      try {
        while (!cancelled) {
          // XREAD COUNT 50 BLOCK 15000 STREAMS <name> <lastId>
          const result = (await queue().redis.xread(
            'COUNT',
            50,
            'BLOCK',
            15_000,
            'STREAMS',
            'vigil:realtime:broadcast',
            lastId,
          )) as Array<[string, Array<[string, string[]]>]> | null;
          if (!result) continue;
          for (const [, entries] of result) {
            for (const [id, fields] of entries) {
              lastId = id;
              // fields is a flat ['k', 'v', 'k', 'v'] array; pull `payload`.
              let payload = '{}';
              for (let i = 0; i < fields.length; i += 2) {
                if (fields[i] === 'payload') payload = fields[i + 1] ?? '{}';
              }
              controller.enqueue(encoder.encode(`id: ${id}\ndata: ${payload}\n\n`));
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`),
        );
      } finally {
        clearInterval(hb);
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
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
