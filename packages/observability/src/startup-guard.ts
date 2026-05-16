import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { startupGuardFailuresTotal } from './metrics.js';

import type { Logger } from './logger.js';

/**
 * Hardening mode 1.7 — Infinite restart loop without circuit breaker.
 *
 * A worker that crashes during init (missing env var, Vault unreachable,
 * Postgres misconfigured) will be restarted by docker-compose every few
 * seconds forever — `restart: unless-stopped` ignores exit codes. The
 * crash-loop generates log noise, eats CPU, and gives the operator no
 * signal that something is structurally wrong.
 *
 * StartupGuard:
 *   1. Tracks the timestamps of recent failed startups in a sentinel
 *      file (default `/run/vigil/<service>.startup-failures.json`).
 *   2. On boot, prunes entries older than `windowMs`, then:
 *      - If the count exceeds `maxFailures`, sleeps for an
 *        exponentially-growing back-off duration BEFORE exiting with
 *        `exitCode`. The sleep slows the restart cadence even when
 *        the orchestrator ignores exit codes (compose's
 *        `unless-stopped`), giving operators bandwidth to intervene.
 *      - Otherwise, records a new "boot-in-progress" entry and returns
 *        a token that the caller MUST resolve via `markBootSuccess()`
 *        once the worker is healthy.
 *   3. Emits `vigil_worker_startup_failures_total{service}` so
 *      operators see the crash-loop pressure via Prometheus even when
 *      logs are noisy.
 *
 * Pattern in main():
 *
 *   const guard = new StartupGuard({ serviceName: 'worker-pattern', logger });
 *   await guard.check();
 *   // ... do init work ...
 *   await guard.markBootSuccess();
 *   // ... main loop ...
 */
export interface StartupGuardOptions {
  readonly serviceName: string;
  readonly logger?: Logger;
  /** Directory holding sentinel files. Default `/run/vigil`. */
  readonly sentinelDir?: string;
  /** Window over which failures are counted. Default 5 minutes. */
  readonly windowMs?: number;
  /** Failure-count ceiling (inclusive) before tripping. Default 5. */
  readonly maxFailures?: number;
  /** Initial pre-exit sleep on trip. Default 30 s. */
  readonly tripSleepInitialMs?: number;
  /** Maximum pre-exit sleep. Default 5 minutes. */
  readonly tripSleepCapMs?: number;
  /** Exit code on trip. Default 42 — a sentinel value for orchestrators
   *  that respect `restart: on-failure:N` policies. */
  readonly exitCode?: number;
}

/** Internal sentinel-file shape. JSON-serialised. */
interface SentinelFile {
  readonly version: 1;
  readonly failures: number[]; // unix-ms timestamps
}

const DEFAULT_DIR = process.env.VIGIL_STARTUP_SENTINEL_DIR ?? '/run/vigil';
const DEFAULT_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_TRIP_SLEEP_INITIAL_MS = 30_000;
const DEFAULT_TRIP_SLEEP_CAP_MS = 5 * 60 * 1_000;
const DEFAULT_EXIT_CODE = 42;

export class StartupGuard {
  private readonly serviceName: string;
  private readonly logger: Logger | undefined;
  private readonly sentinelPath: string;
  private readonly windowMs: number;
  private readonly maxFailures: number;
  private readonly tripSleepInitialMs: number;
  private readonly tripSleepCapMs: number;
  private readonly exitCode: number;
  private bootInProgressMarker: number | null = null;

  constructor(opts: StartupGuardOptions) {
    this.serviceName = opts.serviceName;
    this.logger = opts.logger;
    this.sentinelPath = join(
      opts.sentinelDir ?? DEFAULT_DIR,
      `${opts.serviceName}.startup-failures.json`,
    );
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxFailures = opts.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.tripSleepInitialMs = opts.tripSleepInitialMs ?? DEFAULT_TRIP_SLEEP_INITIAL_MS;
    this.tripSleepCapMs = opts.tripSleepCapMs ?? DEFAULT_TRIP_SLEEP_CAP_MS;
    this.exitCode = opts.exitCode ?? DEFAULT_EXIT_CODE;

    // Materialise the failures-counter label at construction so the
    // `vigil_worker_startup_failures_total{service=<name>}` time series
    // exists in the Prometheus exposition from the first scrape, before
    // any failure has occurred. Without this, operators charting the
    // counter wouldn't see the series until the first trip — which is
    // both the time at which they most need it AND the time at which
    // they'd struggle to differentiate "guard never armed" from "guard
    // armed and clean". The label-materialise pattern is the
    // prom-client-recommended replacement for inc-by-zero.
    startupGuardFailuresTotal.labels({ service: this.serviceName });
  }

  /**
   * Best-effort check that the sentinel directory is writable. Logs at
   * warn level if not — does NOT throw, because boot-blocking on a
   * misconfigured tmpfs would be worse than the diminished crash-loop
   * detection (the sentinel-write failure path now also surfaces
   * via metric + log, so degraded mode is observable).
   *
   * Override the sentinel dir via the VIGIL_STARTUP_SENTINEL_DIR env
   * var or the `sentinelDir` constructor option.
   */
  async preflight(): Promise<void> {
    const dir = dirname(this.sentinelPath);
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, fsConstants.W_OK);
    } catch (e) {
      this.logger?.warn(
        { service: this.serviceName, dir, err: String(e) },
        'startup-guard-sentinel-dir-not-writable; crash-loop detection will run in degraded mode',
      );
    }
  }

  /**
   * Check the failure history. Exits the process if the trip threshold
   * is exceeded; otherwise records a boot-in-progress entry and returns.
   *
   * `now()` is injectable for testing.
   */
  async check(opts: { now?: () => number; exit?: (code: number) => never } = {}): Promise<void> {
    const now = opts.now ?? (() => Date.now());
    const exit = opts.exit ?? ((code: number) => process.exit(code));
    const cutoff = now() - this.windowMs;

    const prior = await this.readSentinel();
    const recent = prior.failures.filter((t) => t >= cutoff);

    if (recent.length >= this.maxFailures) {
      const consecutive = recent.length;
      // Exponential pre-exit sleep capped at tripSleepCapMs.
      const exp = this.tripSleepInitialMs * Math.pow(2, consecutive - this.maxFailures);
      const sleepMs = Math.min(Math.floor(exp), this.tripSleepCapMs);
      startupGuardFailuresTotal.inc({ service: this.serviceName }, 1);
      this.logger?.error(
        {
          service: this.serviceName,
          recent_failures: consecutive,
          window_ms: this.windowMs,
          sleep_ms_before_exit: sleepMs,
          exit_code: this.exitCode,
        },
        'startup-guard-tripped; sleeping before exit to slow the orchestrator restart cadence',
      );
      await sleep(sleepMs);
      exit(this.exitCode);
      return;
    }

    // Record boot-in-progress: append timestamp; persist; remember so
    // markBootSuccess() can remove it.
    const t = now();
    this.bootInProgressMarker = t;
    try {
      await this.writeSentinel({ version: 1, failures: [...recent, t] });
    } catch (e) {
      // Issue #5 — fail-loud. If we cannot persist the boot-in-progress
      // entry, the crash-loop guard is silently bypassed for this boot:
      // a subsequent failure won't be counted because there's no record
      // that this boot was ever in progress. Surface via both metric
      // and log so operators can see the degradation; throw so the
      // worker's main().catch sees the boot did not arm cleanly.
      startupGuardFailuresTotal.inc({ service: this.serviceName }, 1);
      this.logger?.error(
        { service: this.serviceName, sentinelPath: this.sentinelPath, err: String(e) },
        'startup-guard-sentinel-write-failed; crash-loop protection NOT armed for this boot',
      );
      throw new Error(`StartupGuard: sentinel write failed for ${this.serviceName}: ${String(e)}`);
    }
    this.logger?.info(
      {
        service: this.serviceName,
        recent_failures: recent.length,
        window_ms: this.windowMs,
        max_failures: this.maxFailures,
      },
      'startup-guard-armed',
    );
  }

  /**
   * Caller signals "I made it past init; this boot is not a failure".
   * Removes the boot-in-progress marker so the next failed boot doesn't
   * inherit a false-positive entry.
   */
  async markBootSuccess(): Promise<void> {
    if (this.bootInProgressMarker === null) return;
    const prior = await this.readSentinel();
    // Issue #4 mitigation — exact-once removal. The previous
    // `filter(t => t !== marker)` would delete ALL entries matching
    // the timestamp, which on a same-millisecond double-boot would
    // erase the OTHER boot's marker too. indexOf+splice removes
    // exactly one occurrence — the first match — which is correct
    // for our use case (we're removing this boot's own entry, not
    // all entries at that timestamp).
    const filtered = [...prior.failures];
    const idx = filtered.indexOf(this.bootInProgressMarker);
    if (idx >= 0) filtered.splice(idx, 1);
    if (filtered.length === 0) {
      // Clean up the file entirely so an idle service doesn't leave junk.
      await rm(this.sentinelPath, { force: true });
    } else {
      await this.writeSentinel({ version: 1, failures: filtered });
    }
    this.bootInProgressMarker = null;
    this.logger?.info({ service: this.serviceName }, 'startup-guard-cleared');
  }

  private async readSentinel(): Promise<SentinelFile> {
    try {
      const raw = await readFile(this.sentinelPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as Record<string, unknown>).version === 1 &&
        Array.isArray((parsed as Record<string, unknown>).failures)
      ) {
        return parsed as SentinelFile;
      }
      return { version: 1, failures: [] };
    } catch (e) {
      // Missing file is fine — no prior failures.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, failures: [] };
      }
      // Corrupt JSON — treat as empty and rewrite on next persist.
      return { version: 1, failures: [] };
    }
  }

  private async writeSentinel(s: SentinelFile): Promise<void> {
    // Issue #3 — atomic temp+rename write. POSIX `rename(2)` is atomic;
    // concurrent boots cannot observe a half-written sentinel. Per-PID
    // suffix prevents two writers from clobbering each other's tmp file.
    // The non-atomic `writeFile(path, ...)` form (a) allowed a mid-write
    // crash to leave a corrupt JSON, masking the data via the readSentinel
    // fallback to `failures: []`, and (b) under a same-instant rolling
    // deployment could let one writer's content interleave with another's.
    await mkdir(dirname(this.sentinelPath), { recursive: true });
    const tmpPath = `${this.sentinelPath}.tmp.${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(s), 'utf8');
    await rename(tmpPath, this.sentinelPath);
  }
}
