import type Redis from 'ioredis';

/**
 * robots.txt runtime check (Tier 3 hardening).
 *
 * When `infra/sources.json` declares `honor_robots: true`, the adapter MUST
 * fetch the source's robots.txt and refuse paths it disallows. Compliance is
 * a published commitment of the project (SRD §13). This module:
 *
 *   - Fetches /robots.txt once per source per day (cached in Redis).
 *   - Parses the directives that apply to the configured user-agent or `*`.
 *   - Exposes `isAllowed(url, ua)` for adapter-runner pre-flight.
 *
 * Failure-to-fetch robots is treated as "allowed" with a warning — robots is
 * not authoritative on availability, and a 404 is the most common case for
 * Cameroonian government sites that have never published one.
 */

interface Rule {
  readonly type: 'allow' | 'disallow';
  readonly path: string;
}

export interface ParsedRobots {
  readonly fetchedAt: number; // epoch ms
  readonly groups: ReadonlyArray<{ readonly agents: readonly string[]; readonly rules: readonly Rule[] }>;
}

export function parseRobots(text: string): ParsedRobots {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'allow' && current) {
      current.rules.push({ type: 'allow', path: value });
    } else if (key === 'disallow' && current) {
      current.rules.push({ type: 'disallow', path: value });
    }
  }
  return { fetchedAt: Date.now(), groups };
}

function matchesAgent(rule: { agents: readonly string[] }, ua: string): boolean {
  const lower = ua.toLowerCase();
  return rule.agents.some((a) => a === '*' || lower.includes(a));
}

/** Returns true iff robots.txt allows `path` for `ua`. */
export function robotsAllows(parsed: ParsedRobots, path: string, ua: string): boolean {
  // Per RFC 9309: most-specific group wins; if multiple agent strings match,
  // pick the longest agent token. Within the chosen group, the longest path
  // pattern wins; if equal length, allow > disallow.
  const candidates = parsed.groups.filter((g) => matchesAgent(g, ua));
  if (candidates.length === 0) return true;
  const group = candidates.reduce<typeof candidates[number]>((best, g) => {
    const bestSpec = Math.max(...best.agents.map((a) => (a === '*' ? 0 : a.length)));
    const gSpec = Math.max(...g.agents.map((a) => (a === '*' ? 0 : a.length)));
    return gSpec > bestSpec ? g : best;
  }, candidates[0]!);

  let bestRule: Rule | null = null;
  let bestLen = -1;
  for (const r of group.rules) {
    if (r.path === '') continue;
    if (path.startsWith(r.path)) {
      const len = r.path.length;
      if (len > bestLen || (len === bestLen && bestRule?.type === 'disallow' && r.type === 'allow')) {
        bestRule = r;
        bestLen = len;
      }
    }
  }
  if (!bestRule) return true;
  return bestRule.type === 'allow';
}

export class RobotsChecker {
  constructor(
    private readonly redis: Redis,
    private readonly fetchFn: (url: string) => Promise<{ status: number; body: string }> = defaultFetch,
    private readonly cacheTtlSec = 24 * 3600,
  ) {}

  private cacheKey(origin: string): string {
    return `adapter:robots:${origin}`;
  }

  /**
   * Returns true if `url` may be fetched by an adapter using `userAgent`.
   * On any error fetching robots.txt, returns true (best-effort) but logs.
   */
  async isAllowed(url: string, userAgent: string): Promise<boolean> {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    const cached = await this.redis.get(this.cacheKey(origin));
    let parsed: ParsedRobots | null = null;
    if (cached) {
      try {
        parsed = JSON.parse(cached) as ParsedRobots;
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      try {
        const res = await this.fetchFn(`${origin}/robots.txt`);
        if (res.status === 200) {
          parsed = parseRobots(res.body);
        } else {
          // 404 / 403 / etc: treat as no robots → allow.
          parsed = { fetchedAt: Date.now(), groups: [] };
        }
        await this.redis.set(this.cacheKey(origin), JSON.stringify(parsed), 'EX', this.cacheTtlSec);
      } catch {
        return true; // fail-open per RFC 9309 spirit
      }
    }
    return robotsAllows(parsed, u.pathname + u.search, userAgent);
  }
}

async function defaultFetch(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'VIGIL-APEX/robots-check' },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.text() };
}
