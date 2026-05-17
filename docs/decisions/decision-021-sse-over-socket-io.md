# DECISION-021 — Server-Sent Events over Socket.io for the operator dashboard

| Field      | Value                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-05-17                                                                                                                                                               |
| Decided by | Junior Thuram Nana, Sovereign Architect                                                                                                                                  |
| Status     | **FINAL**                                                                                                                                                                |
| Supersedes | Implementation-plan §"Live heatmap" mention of "Socket.io for live updates" (`docs/IMPLEMENTATION-PLAN.md` historical drift; never coded)                                |
| Affects    | `apps/dashboard/src/app/api/realtime/route.ts`, `apps/dashboard/src/app/api/alerts/stream/route.ts`, future real-time surfaces (council vote ticker, findings live feed) |
| Closes     | R3.C from the heatmap / alerts / W-10 build                                                                                                                              |

---

## Decision

All server-to-client real-time channels in the operator dashboard
ship as **Server-Sent Events (SSE)**, not Socket.io.

This applies to:

- `/api/realtime` — general dashboard fan-out (existing, Phase C12).
- `/api/alerts/stream` — anomaly-alert delta stream (built in R3.B).
- Any future surface needing server-push updates (council vote
  ticker, satellite-recheck progress, dossier-render queue depth).

Client-side: vanilla `EventSource` API. No `socket.io-client`
dependency. No upgrade-to-WebSocket negotiation.

---

## Why this is being decided now

The implementation plan (`docs/IMPLEMENTATION-PLAN.md`, Phase C12)
historically listed "Socket.io for live updates" as the target tech.
That line was a placeholder from the early scaffold — it predated
the SSE-based `/api/realtime` route that worker-broadcast actually
publishes to. The drift between the plan text and the shipped route
is a documentation-vs-code mismatch the build agent has been
silently re-asking-for-clarification on for several sessions.

This decision **pins SSE as canonical** so the implementation-plan
audit (R3.E) can tick the box honestly and so a future agent does
not ship a parallel Socket.io path that fragments the substrate.

---

## Rationale

### What we actually need from "real-time"

The dashboard's real-time surfaces are all **one-way, server →
client, server-authoritative**:

| Surface              | Direction     | Cadence                | Reverse channel?       |
| -------------------- | ------------- | ---------------------- | ---------------------- |
| `/api/realtime`      | server→client | <1/s steady, 10/s peak | none (REST for writes) |
| `/api/alerts/stream` | server→client | <1/min steady          | none                   |
| Future: vote ticker  | server→client | <1/min                 | none (REST for votes)  |
| Future: render-queue | server→client | <1/s during render     | none                   |

Nothing in the operator surface needs the browser to push frames
back over the same socket. Every operator action goes through a
plain HTTP POST that the audit-chain wraps (TAL-PA halt-on-failure
semantics; see `apps/dashboard/src/lib/audit-emit.server.ts`). The
write path **must** be auditable per-request — replaying it through
a Socket.io message would force us to re-do the audit-wrapping at
the socket layer.

### What we lose by not using Socket.io

- **Auto-reconnect with exponential backoff.** EventSource
  reconnects automatically with a constant cadence (~3 s in most
  browsers). For the alerts / realtime surfaces this is fine —
  there's no streaming-video-like jitter penalty to a 3 s gap. If
  some surface ever needs jitter-free reconnect, the `EventSource`
  spec lets the server send an `id:` header which the browser
  echoes back as `Last-Event-ID` on reconnect; the existing route
  in `/api/realtime` already implements this with the Redis stream
  id.
- **Binary frames.** SSE is text-only. None of our surfaces push
  binary; the payloads are small JSON envelopes.
- **Multiplexing one socket across many channels.** Each EventSource
  is one TCP connection. With HTTP/2 multiplexing (which Caddy
  fronts everywhere), the cost of two connections is one extra
  HEADERS frame, not a new TCP handshake. Acceptable.

### What we gain by NOT using Socket.io

1. **No client-side dependency.** `EventSource` is a native browser
   API. Socket.io's client is ~50 KB minified, which would land in
   every operator's bundle even if they never opened a real-time
   page. SSE keeps the dashboard bundle small enough that an
   operator on a 3G connection in Ngaoundéré still loads under 3 s.

2. **Works through Caddy + Tor + Cloudflare unchanged.** SSE is
   plain HTTP/1.1 chunked encoding (or HTTP/2). Every reverse proxy
   in the stack passes it through. Socket.io upgrades to WebSocket
   over HTTP/1.1 `Upgrade: websocket`, which has to be explicitly
   permitted at every hop. Cloudflare WebSocket support has caveats
   under the Enterprise tier; Tor v3 onion services do route
   WebSocket but the upgrade handshake is one more thing that can
   break under network partition.

3. **Plain `curl -N` debugs the stream.** `curl -N
https://dash.vigilapex.cm/api/alerts/stream` lets an operator or
   SRE see the raw event flow without spinning up a Socket.io
   client. Critical for forensic post-mortems where the failure
   IS the SSE channel.

4. **The audit chain stays HTTP-shaped.** Every event the server
   emits over SSE is also queryable via the standard REST
   endpoints (e.g. `GET /api/alerts?since=X`). SSE is just the
   live cadence of an already-queryable resource. With Socket.io
   we'd have to maintain a parallel write-path through the socket
   transport and re-prove that audit emit semantics hold there.

5. **Edge runtime stays a viable future option.** Next.js Edge
   runtime kills long-lived connections at the platform's idle
   limit, but the timeout window is generous for SSE (we just need
   25 s heartbeats); Edge runtime does not support WebSocket
   upgrades at all. SSE leaves the door open to running the
   dashboard on Edge if the cluster sizing argues for it.

### Why polling-backed SSE for `/api/alerts/stream`

The alerts surface pushes new rows by polling
`audit.anomaly_alert` every 5 s with a `detected_at > cursor`
filter. We considered Postgres LISTEN/NOTIFY for a push-only path
but rejected it:

- One LISTEN per SSE subscriber pins a long-lived Postgres
  connection. At N=200 concurrent operators that's 200 connections
  held idle, dwarfing the pool.
- Dropped NOTIFY messages are silently lost; the polling path heals
  naturally on the next tick.
- 5 s latency is acceptable for the alerts surface (it's not a
  trading screen) and matches an operator's natural reaction time.

This polling-vs-NOTIFY trade is internal to the SSE route — it does
not affect the SSE-vs-Socket.io question. We may switch the alerts
route to NOTIFY-backed in the future if the operator count climbs.

---

## Implementation contract

Every SSE route in the dashboard:

1. Sets `Content-Type: text/event-stream; charset=utf-8`,
   `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.
2. Uses `runtime = 'nodejs'` (Edge runtime times out long-lived
   streams at the platform's per-platform idle threshold).
3. Uses `dynamic = 'force-dynamic'` to defeat Next.js's static
   inference (long-lived response bodies are not cacheable).
4. Emits a `ping` event every ≤ 25 s via
   `startSseHeartbeat({ intervalMs: 25_000, signal, onTick })`.
   25 s is below the lowest reasonable reverse-proxy idle timeout
   (Cloudflare default 30 s, Caddy default 0 = no timeout but
   intermediaries may interpose).
5. Wires an `AbortController`/`AbortSignal` that the `cancel()`
   handler of the `ReadableStream` aborts, so the heartbeat helper
   observes disconnects synchronously rather than on the next poll
   boundary.
6. Catches all errors INSIDE the stream, logs them server-side with
   `{ errName, errMsg }` only (no error.stack on the wire — see
   Hardening Mode 4.9), and emits an opaque
   `event: error\ndata: {"error":"…"}` to the client.

Routes that already comply:

- `apps/dashboard/src/app/api/realtime/route.ts` (the Redis-stream
  fan-out, Phase C12)
- `apps/dashboard/src/app/api/alerts/stream/route.ts` (R3.B)

Future SSE routes adopt the same shape; the heartbeat helper at
`apps/dashboard/src/lib/sse-heartbeat.ts` enforces invariants 4–5
by API.

---

## Re-open triggers

This decision should be revisited if:

1. **The operator surface gains a bidirectional real-time need.** For
   instance, a collaborative annotation surface where two
   investigators are editing the same finding's evidence chain and
   need cursor-position broadcast. SSE plus REST writes does not fit
   that shape; WebSocket (and probably Socket.io's room/namespace
   abstractions) does.

2. **Cloudflare or Tor materially changes their SSE-pass-through
   semantics.** Currently both work; if either starts buffering
   chunked responses we lose the latency floor and would have to
   rebuild on WebSocket upgrade.

3. **Per-connection cost on the server exceeds the pool budget.**
   Each SSE subscriber holds one Next.js request alive for the
   duration of the session. At N=2000 concurrent operators with one
   SSE per browser tab we'd pin ~4000 connections. Mitigations
   exist (single shared SSE per operator multiplexing channels by
   `event:` name; SharedWorker on the client) but if the migration
   cost approaches WebSocket-class complexity we reconsider.

---

## Cross-references

- `apps/dashboard/src/app/api/realtime/route.ts` — original SSE
  route (Phase C12).
- `apps/dashboard/src/app/api/alerts/stream/route.ts` — R3.B SSE
  route for the anomaly-alert delta stream.
- `apps/dashboard/src/lib/sse-heartbeat.ts` — 25 s heartbeat helper
  with abort-signal semantics (AUDIT-035).
- `apps/dashboard/__tests__/sse-heartbeat.test.ts` — 6 tests pinning
  the heartbeat helper's abort + interval behaviour.
- `docs/IMPLEMENTATION-PLAN.md` — Phase C12 — drift line removed
  in R3.E.
