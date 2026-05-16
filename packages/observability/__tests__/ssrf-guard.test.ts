import { describe, expect, it } from 'vitest';

import { isPublicHttpUrl } from '../src/ssrf-guard.js';

describe('isPublicHttpUrl — scheme rejection', () => {
  it('rejects unparseable input', () => {
    const r = isPublicHttpUrl('not-a-url');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unparseable');
  });

  it('rejects file:// scheme', () => {
    const r = isPublicHttpUrl('file:///etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('scheme-not-http');
  });

  it('rejects gopher:// scheme', () => {
    const r = isPublicHttpUrl('gopher://example.org/_');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('scheme-not-http');
  });

  it('rejects javascript: scheme', () => {
    const r = isPublicHttpUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects data: scheme', () => {
    const r = isPublicHttpUrl('data:text/plain;base64,YWJj');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('scheme-not-http');
  });

  it('accepts http://', () => {
    expect(isPublicHttpUrl('http://example.org/path').ok).toBe(true);
  });

  it('accepts https://', () => {
    expect(isPublicHttpUrl('https://example.org/path').ok).toBe(true);
  });
});

describe('isPublicHttpUrl — reserved hostnames', () => {
  it('rejects localhost', () => {
    expect(isPublicHttpUrl('http://localhost/').ok).toBe(false);
  });

  it('rejects localhost with port', () => {
    expect(isPublicHttpUrl('http://localhost:5432/').ok).toBe(false);
  });

  it('rejects ip6-localhost', () => {
    expect(isPublicHttpUrl('http://ip6-localhost/').ok).toBe(false);
  });
});

describe('isPublicHttpUrl — internal hostname suffixes', () => {
  it('rejects *.local', () => {
    const r = isPublicHttpUrl('http://printer.local/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('internal-suffix');
  });

  it('rejects *.internal (AWS metadata-adjacent convention)', () => {
    expect(isPublicHttpUrl('http://api.internal/').ok).toBe(false);
  });

  it('rejects *.intranet', () => {
    expect(isPublicHttpUrl('http://wiki.intranet/').ok).toBe(false);
  });

  it('rejects *.lan', () => {
    expect(isPublicHttpUrl('http://nas.lan/').ok).toBe(false);
  });

  it('rejects *.corp', () => {
    expect(isPublicHttpUrl('http://service.corp/').ok).toBe(false);
  });
});

describe('isPublicHttpUrl — private IPv4 ranges', () => {
  it('rejects loopback 127.0.0.1', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/').ok).toBe(false);
  });

  it('rejects loopback 127.255.255.254', () => {
    expect(isPublicHttpUrl('http://127.255.255.254/').ok).toBe(false);
  });

  it('rejects RFC1918 10.0.0.1', () => {
    expect(isPublicHttpUrl('http://10.0.0.1/').ok).toBe(false);
  });

  it('rejects RFC1918 172.16.0.1', () => {
    expect(isPublicHttpUrl('http://172.16.0.1/').ok).toBe(false);
  });

  it('rejects RFC1918 172.31.255.254', () => {
    expect(isPublicHttpUrl('http://172.31.255.254/').ok).toBe(false);
  });

  it('rejects RFC1918 192.168.1.1', () => {
    expect(isPublicHttpUrl('http://192.168.1.1/').ok).toBe(false);
  });

  it('rejects AWS metadata 169.254.169.254', () => {
    expect(isPublicHttpUrl('http://169.254.169.254/').ok).toBe(false);
  });

  it('rejects link-local 169.254.0.1', () => {
    expect(isPublicHttpUrl('http://169.254.0.1/latest/meta-data/').ok).toBe(false);
  });

  it('rejects "this network" 0.0.0.0', () => {
    expect(isPublicHttpUrl('http://0.0.0.0/').ok).toBe(false);
  });

  it('rejects CGNAT 100.64.0.1', () => {
    expect(isPublicHttpUrl('http://100.64.0.1/').ok).toBe(false);
  });

  it('rejects multicast 224.0.0.1', () => {
    expect(isPublicHttpUrl('http://224.0.0.1/').ok).toBe(false);
  });

  it('accepts public IPv4 8.8.8.8', () => {
    expect(isPublicHttpUrl('http://8.8.8.8/').ok).toBe(true);
  });

  it('accepts public IPv4 198.41.0.4 (Verisign root)', () => {
    expect(isPublicHttpUrl('http://198.41.0.4/').ok).toBe(true);
  });

  it('borderline 172.32.0.1 is public (RFC1918 ends at 172.31)', () => {
    expect(isPublicHttpUrl('http://172.32.0.1/').ok).toBe(true);
  });
});

describe('isPublicHttpUrl — private IPv6', () => {
  it('rejects IPv6 loopback ::1', () => {
    expect(isPublicHttpUrl('http://[::1]/').ok).toBe(false);
  });

  it('rejects unspecified ::', () => {
    expect(isPublicHttpUrl('http://[::]/').ok).toBe(false);
  });

  it('rejects link-local fe80::1', () => {
    expect(isPublicHttpUrl('http://[fe80::1]/').ok).toBe(false);
  });

  it('rejects unique-local fc00::1', () => {
    expect(isPublicHttpUrl('http://[fc00::1]/').ok).toBe(false);
  });

  it('rejects unique-local fd00::1', () => {
    expect(isPublicHttpUrl('http://[fd00::1]/').ok).toBe(false);
  });

  it('rejects documentation 2001:db8::1', () => {
    expect(isPublicHttpUrl('http://[2001:db8::1]/').ok).toBe(false);
  });

  it('rejects multicast ff02::1', () => {
    expect(isPublicHttpUrl('http://[ff02::1]/').ok).toBe(false);
  });

  it('rejects IPv4-mapped ::ffff:127.0.0.1', () => {
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/').ok).toBe(false);
  });

  it('rejects IPv4-mapped ::ffff:169.254.169.254', () => {
    expect(isPublicHttpUrl('http://[::ffff:169.254.169.254]/').ok).toBe(false);
  });

  it('accepts public IPv6 2606:4700:4700::1111 (Cloudflare DNS)', () => {
    expect(isPublicHttpUrl('http://[2606:4700:4700::1111]/').ok).toBe(true);
  });
});

describe('isPublicHttpUrl — single-label hostnames', () => {
  it('rejects single-label hostname like "vault"', () => {
    const r = isPublicHttpUrl('http://vault/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('single-label-hostname');
  });

  it('rejects single-label "redis"', () => {
    expect(isPublicHttpUrl('http://redis:6379/').ok).toBe(false);
  });

  it('rejects single-label "postgres"', () => {
    expect(isPublicHttpUrl('http://postgres:5432/').ok).toBe(false);
  });

  it('rejects single-label k8s "kubernetes"', () => {
    expect(isPublicHttpUrl('http://kubernetes/').ok).toBe(false);
  });
});

describe('isPublicHttpUrl — extraAllowedHosts', () => {
  it('permits a normally-rejected single-label host when allowlisted', () => {
    const r = isPublicHttpUrl('http://vault/', { extraAllowedHosts: ['vault'] });
    expect(r.ok).toBe(true);
  });

  it('matches allowlist case-insensitively', () => {
    const r = isPublicHttpUrl('http://Vault/', { extraAllowedHosts: ['vault'] });
    expect(r.ok).toBe(true);
  });

  it('does NOT permit private IP via allowlist (IP is a literal, not matched by host strings)', () => {
    // Allowlist matches by string equality; "10.0.0.1" would only pass if
    // a deployer explicitly opted in. This test pins that interface.
    const r = isPublicHttpUrl('http://10.0.0.1/', { extraAllowedHosts: ['vault'] });
    expect(r.ok).toBe(false);
  });
});

describe('isPublicHttpUrl — empty / edge cases', () => {
  it('rejects empty string', () => {
    expect(isPublicHttpUrl('').ok).toBe(false);
  });

  it('rejects http:// (no host)', () => {
    const r = isPublicHttpUrl('http://');
    expect(r.ok).toBe(false);
  });

  it('accepts a real registered domain with path + query', () => {
    expect(isPublicHttpUrl('https://www.conac.cm/reports?year=2024').ok).toBe(true);
  });
});
