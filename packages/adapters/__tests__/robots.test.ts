import { describe, expect, it, vi } from 'vitest';

import { parseRobots, RobotsChecker, robotsAllows } from '../src/robots.js';

describe('parseRobots', () => {
  it('parses agent groups + allow/disallow rules', () => {
    const r = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/public/

User-agent: VIGIL-APEX/1.0
Disallow: /admin/
`.trim());
    expect(r.groups.length).toBe(2);
    expect(r.groups[0]!.agents).toContain('*');
    expect(r.groups[0]!.rules.length).toBe(2);
  });

  it('ignores comments + blank lines', () => {
    const r = parseRobots(`# header\nUser-agent: *\n\n# another\nDisallow: /x\n`);
    expect(r.groups[0]!.rules[0]!.path).toBe('/x');
  });
});

describe('robotsAllows', () => {
  it('allows when no group matches the agent', () => {
    const parsed = parseRobots('User-agent: GoogleBot\nDisallow: /');
    expect(robotsAllows(parsed, '/anything', 'VIGIL-APEX/1.0')).toBe(true);
  });

  it('denies disallowed path under wildcard agent', () => {
    const parsed = parseRobots('User-agent: *\nDisallow: /private');
    expect(robotsAllows(parsed, '/private', 'VIGIL-APEX/1.0')).toBe(false);
    expect(robotsAllows(parsed, '/private/x', 'VIGIL-APEX/1.0')).toBe(false);
    expect(robotsAllows(parsed, '/public', 'VIGIL-APEX/1.0')).toBe(true);
  });

  it('agent-specific group overrides the wildcard', () => {
    const parsed = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: VIGIL\nAllow: /\nDisallow: /admin',
    );
    expect(robotsAllows(parsed, '/data', 'VIGIL-APEX/1.0')).toBe(true);
    expect(robotsAllows(parsed, '/admin', 'VIGIL-APEX/1.0')).toBe(false);
  });

  it('longest-match path rule wins', () => {
    const parsed = parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/public
`.trim());
    expect(robotsAllows(parsed, '/private/secret', 'VIGIL/1.0')).toBe(false);
    expect(robotsAllows(parsed, '/private/public/page', 'VIGIL/1.0')).toBe(true);
  });
});

class FakeRedis {
  private store = new Map<string, string>();
  async get(k: string): Promise<string | null> {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, _ex: 'EX', _ttl: number): Promise<'OK'> {
    this.store.set(k, v);
    return 'OK';
  }
}

describe('RobotsChecker', () => {
  it('caches robots.txt and re-uses it', async () => {
    const redis = new FakeRedis();
    let fetches = 0;
    const fetchFn = vi.fn(async () => {
      fetches++;
      return { status: 200, body: 'User-agent: *\nDisallow: /admin' };
    });
    const checker = new RobotsChecker(redis as unknown as never, fetchFn);
    expect(await checker.isAllowed('https://x.test/admin', 'VIGIL/1.0')).toBe(false);
    expect(await checker.isAllowed('https://x.test/admin', 'VIGIL/1.0')).toBe(false);
    expect(fetches).toBe(1); // cache hit on the second call
  });

  it('treats 404 robots.txt as allow', async () => {
    const redis = new FakeRedis();
    const fetchFn = vi.fn(async () => ({ status: 404, body: '' }));
    const checker = new RobotsChecker(redis as unknown as never, fetchFn);
    expect(await checker.isAllowed('https://x.test/anything', 'VIGIL/1.0')).toBe(true);
  });

  it('fails open if robots.txt fetch throws', async () => {
    const redis = new FakeRedis();
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const checker = new RobotsChecker(redis as unknown as never, fetchFn);
    expect(await checker.isAllowed('https://x.test/anything', 'VIGIL/1.0')).toBe(true);
  });
});
