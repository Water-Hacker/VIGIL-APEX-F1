# Mode 4.9 — Verbose error response leaking internal state

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 5 / Category 4
**Branch:** `hardening/phase-1-orientation`

## The failure mode

API routes catch internal errors (IPFS fetch failure, audit emitter unavailable, Redis stream interruption) and echo `String(err)` or `err.message`/`err.stack` to the client. The stringified error carries stack traces, internal file paths, library version strings, Postgres/Redis/Vault connection details — all useful for an attacker mapping the platform's internals.

Pre-closure:

- `apps/dashboard/src/app/api/dossier/[ref]/route.ts:83` — `{ error: 'ipfs-fetch-failed', message: String(err) }` echoed the full IPFS error including kubo-rpc-client internals.
- Same file `:104` — `{ error: 'audit-emitter-unavailable', message: err.message }` echoed Postgres / Vault internals from the AuditEmitterUnavailableError.
- `apps/dashboard/src/app/api/realtime/route.ts:83` — SSE error event payload was `{ message: String(err) }`, leaking Redis stream details to any client subscribing.

## What was added

### 1. Fix the three call sites

| File                                                | Change                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/api/dossier/[ref]/route.ts` | IPFS-fetch-failed path now logs `{ err, ref, lang, cid }` server-side via the pino logger; client sees `{ error: 'ipfs-fetch-failed' }`. Audit-emitter-unavailable path similarly logs server-side; client sees opaque code. |
| `apps/dashboard/src/app/api/realtime/route.ts`      | SSE error event payload is now `{ error: 'stream-error' }`; full `err` logged server-side.                                                                                                                                   |

Both files now import `createLogger` from `@vigil/observability` and log to a per-route logger (`api-dossier`, `api-realtime`). The errors are observable in production logs; they are NOT observable to clients.

### 2. CI gate `scripts/check-api-error-leaks.ts`

Scans every `.ts`/`.tsx` file under `apps/dashboard/src/app/api/` for the anti-patterns:

- `message: String(err)` (and `e`, `error`, `caught`)
- `message: err.message` / `err.stack` (and same for `e`, `error`, `caught`)

Per-line suppression via `// allow: error-message-echo <reason>` for cases where echoing IS safe (e.g. Zod validation errors where the message is user-input feedback). The suppression marker requires a reason so reviewers can audit.

Currently reports: `OK — 20 API files scanned, 0 leaks.`

### 3. CI workflow gate

`.github/workflows/ci.yml` — new `api-error-leaks` job runs the script on every PR/push. Failure blocks merge.

### 4. Regex unit tests

`scripts/__tests__/check-api-error-leaks.test.ts` — 7 cases:

- Real-tree happy path (exit 0 against current api/).
- Regex unit cases: `message: String(err)`, `message: err.message`, `message: err.stack`, `message: e.message` single-letter binding, `message: "static literal"` (correctly allowed), `message: variableName` (correctly allowed when not a caught-error name).

## The invariant

Three layers:

1. **CI gate `api-error-leaks`** — blocks new violations.
2. **Regex unit tests** — lock the rule semantics so a future refactor of the gate can't accidentally widen the allowlist.
3. **Per-line suppression marker requires a reason** — reviewers see the rationale next to the code.

## What this closure does NOT include

- **A broader scan across server-side worker code.** The orientation framed mode 4.9 as a public-surface concern (`/api/*` routes are reached by external HTTP clients). Worker logs are internal; leaking the stringified error there is acceptable because it's the OPERATOR who reads them. Worker code is out of scope for this gate.
- **An audit of every `console.error` / `logger.error` call**. The gate only catches the response-echo pattern. Logger calls are intentionally verbose; the rule is "log everything server-side; expose only opaque codes to clients."
- **Replacing the gate with a TypeScript lint rule**. A custom ESLint rule would be more semantically precise (e.g. detect `NextResponse.json({ message: ... })` shapes), but the regex gate is sufficient and adds zero ESLint complexity. Flagged for follow-up if false positives appear in practice.

## Files touched

- `apps/dashboard/src/app/api/dossier/[ref]/route.ts` (logger added; two echo paths fixed)
- `apps/dashboard/src/app/api/realtime/route.ts` (logger added; one echo path fixed)
- `scripts/check-api-error-leaks.ts` (new, 117 lines)
- `scripts/__tests__/check-api-error-leaks.test.ts` (new, 64 lines)
- `.github/workflows/ci.yml` (+19 lines, new `api-error-leaks` job)
- `docs/audit/evidence/hardening/category-4/mode-4.9/CLOSURE.md` (this file)

## Verification

- `pnpm --filter dashboard run typecheck` — clean.
- `npx tsx scripts/check-api-error-leaks.ts` — `OK — 20 API files scanned, 0 leaks.`
- Manual review of the two fixed routes confirms client-visible responses contain no `message:` field with caught-error content.
