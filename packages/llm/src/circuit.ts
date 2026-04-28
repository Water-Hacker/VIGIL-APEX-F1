import { createLogger, type Logger } from '@vigil/observability';

/**
 * Circuit breaker — tracks consecutive failures within a rolling window and
 * trips when threshold reached. While tripped, callers should fail-over.
 *
 * Auto-reset: every probe interval, allow ONE trial; if it succeeds, close.
 */

export interface CircuitOptions {
  readonly name: string;
  readonly failureThreshold: number;
  readonly failureWindowMs: number;
  readonly probeIntervalMs: number;
  readonly latencyTimeoutMs?: number;
  readonly logger?: Logger;
}

type State = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: State = 'closed';
  private readonly failures: number[] = []; // timestamps of recent failures
  private nextProbeAt = 0;
  private readonly logger: Logger;

  constructor(private readonly opts: CircuitOptions) {
    this.logger = opts.logger ?? createLogger({ service: `circuit:${opts.name}` });
  }

  isOpen(): boolean {
    if (this.state !== 'open') return false;
    if (Date.now() >= this.nextProbeAt) {
      this.state = 'half-open';
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures.length = 0;
    if (this.state !== 'closed') {
      this.logger.info('circuit-closed');
      this.state = 'closed';
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    // Drop entries older than window
    const cutoff = now - this.opts.failureWindowMs;
    while (this.failures.length > 0 && this.failures[0]! < cutoff) {
      this.failures.shift();
    }
    if (this.failures.length >= this.opts.failureThreshold) {
      if (this.state !== 'open') {
        this.logger.warn(
          { failures: this.failures.length, threshold: this.opts.failureThreshold },
          'circuit-opened',
        );
      }
      this.state = 'open';
      this.nextProbeAt = now + this.opts.probeIntervalMs;
    }
  }

  recordTimeout(): void {
    this.recordFailure();
  }

  /** True if a latency exceeds the breaker's deadline (treated as failure). */
  isLatencyExceeded(latencyMs: number): boolean {
    return this.opts.latencyTimeoutMs !== undefined && latencyMs > this.opts.latencyTimeoutMs;
  }

  getState(): State {
    return this.state;
  }
}
