import { createLogger, type Logger } from '@vigil/observability';

/**
 * Layered egress policy (W-13 fix):
 *   1. Default: Hetzner DC IP with honest UA
 *   2. On 403/451: escalate to Bright Data residential
 *   3. On second escalation: Tor over Bright Data
 *   4. Never two consecutive escalations on the same source within 24 h
 */

export type ProxyTier = 'hetzner-dc' | 'bright-data-residential' | 'tor-over-bright-data';

export interface ProxyEndpoint {
  readonly tier: ProxyTier;
  readonly url: string | null; // null = direct Hetzner DC IP
  readonly region?: string;
}

export interface ProxyManagerOptions {
  readonly hetznerDcEnabled?: boolean;
  readonly brightDataUsername?: string;
  readonly brightDataPassword?: string;
  readonly brightDataZone?: string;
  readonly torSocksHost?: string;
  readonly torSocksPort?: number;
  readonly logger?: Logger;
}

export class ProxyManager {
  private readonly logger: Logger;
  private readonly opts: ProxyManagerOptions;
  /** Per-source escalation history — sourceId → [{ at, tier }] */
  private readonly escalations = new Map<string, Array<{ at: number; tier: ProxyTier }>>();

  constructor(opts: ProxyManagerOptions = {}) {
    this.opts = opts;
    this.logger = opts.logger ?? createLogger({ service: 'proxy-manager' });
  }

  defaultEndpoint(): ProxyEndpoint {
    return { tier: 'hetzner-dc', url: null };
  }

  /** Pick the appropriate endpoint for a source, honouring 24h escalation rule. */
  endpointFor(sourceId: string, currentBlocked: boolean): ProxyEndpoint {
    const history = this.escalations.get(sourceId) ?? [];
    const recent = history.filter((h) => Date.now() - h.at < 86_400_000);

    if (!currentBlocked) return this.defaultEndpoint();

    // First escalation in 24h ⇒ Bright Data
    if (recent.length === 0 || recent[recent.length - 1]!.tier === 'hetzner-dc') {
      return this.brightDataEndpoint();
    }
    // Second escalation already happened ⇒ Tor over Bright Data
    if (recent.length >= 1 && recent[recent.length - 1]!.tier === 'bright-data-residential') {
      return this.torOverBrightDataEndpoint();
    }
    return this.brightDataEndpoint();
  }

  recordEscalation(sourceId: string, tier: ProxyTier): void {
    const arr = this.escalations.get(sourceId) ?? [];
    arr.push({ at: Date.now(), tier });
    // Trim to last 24h
    const cutoff = Date.now() - 86_400_000;
    this.escalations.set(
      sourceId,
      arr.filter((h) => h.at >= cutoff),
    );
    this.logger.warn({ sourceId, tier }, 'proxy-escalation');
  }

  private brightDataEndpoint(): ProxyEndpoint {
    const u = this.opts.brightDataUsername;
    const p = this.opts.brightDataPassword;
    const zone = this.opts.brightDataZone ?? 'residential';
    if (!u || !p) {
      this.logger.warn('bright-data-not-configured; falling back to direct');
      return this.defaultEndpoint();
    }
    return {
      tier: 'bright-data-residential',
      url: `http://${u}-zone-${zone}:${p}@brd.superproxy.io:22225`,
    };
  }

  private torOverBrightDataEndpoint(): ProxyEndpoint {
    return {
      tier: 'tor-over-bright-data',
      url: `socks5h://${this.opts.torSocksHost ?? 'vigil-tor'}:${this.opts.torSocksPort ?? 9050}`,
    };
  }
}
