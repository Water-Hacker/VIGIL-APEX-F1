import { describe, expect, it } from 'vitest';

import {
  InvalidWebauthnOriginError,
  parseAllowedWebauthnOrigins,
} from '../src/lib/webauthn-origin';

describe('AUDIT-038 — parseAllowedWebauthnOrigins normalises trailing slash + explicit port', () => {
  it('falls back to https://<rpId> when the env var is unset', () => {
    expect(parseAllowedWebauthnOrigins(undefined, 'vigilapex.cm')).toEqual([
      'https://vigilapex.cm',
    ]);
  });

  it('falls back when the env var is empty or whitespace', () => {
    expect(parseAllowedWebauthnOrigins('', 'vigilapex.cm')).toEqual(['https://vigilapex.cm']);
    expect(parseAllowedWebauthnOrigins('   ', 'vigilapex.cm')).toEqual(['https://vigilapex.cm']);
  });

  it('trims trailing slash from each entry', () => {
    expect(parseAllowedWebauthnOrigins('https://vigilapex.cm/', 'rp')).toEqual([
      'https://vigilapex.cm',
    ]);
  });

  it('drops the explicit :443 on https origins', () => {
    expect(parseAllowedWebauthnOrigins('https://vigilapex.cm:443', 'rp')).toEqual([
      'https://vigilapex.cm',
    ]);
  });

  it('drops the explicit :80 on http origins (test-env shape)', () => {
    expect(parseAllowedWebauthnOrigins('http://localhost:80', 'rp')).toEqual(['http://localhost']);
  });

  it('preserves a non-default port', () => {
    expect(parseAllowedWebauthnOrigins('https://staging.vigilapex.cm:8443', 'rp')).toEqual([
      'https://staging.vigilapex.cm:8443',
    ]);
  });

  it('splits a comma-separated list and trims each entry', () => {
    expect(
      parseAllowedWebauthnOrigins(
        '  https://vigilapex.cm/  ,  https://staging.vigilapex.cm:443 , https://localhost:3000 ',
        'rp',
      ),
    ).toEqual(['https://vigilapex.cm', 'https://staging.vigilapex.cm', 'https://localhost:3000']);
  });

  it('de-duplicates equivalent origins', () => {
    expect(
      parseAllowedWebauthnOrigins(
        'https://vigilapex.cm,https://vigilapex.cm/,https://vigilapex.cm:443',
        'rp',
      ),
    ).toEqual(['https://vigilapex.cm']);
  });

  it('throws InvalidWebauthnOriginError on malformed entry, naming the bad string', () => {
    let err: unknown;
    try {
      parseAllowedWebauthnOrigins('https://ok.cm,not a url', 'rp');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidWebauthnOriginError);
    expect((err as InvalidWebauthnOriginError).bad).toBe('not a url');
    expect((err as Error).message).toContain('not a url');
  });

  it('skips empty list entries (trailing comma, double comma)', () => {
    expect(parseAllowedWebauthnOrigins('https://a.cm,,https://b.cm,', 'rp')).toEqual([
      'https://a.cm',
      'https://b.cm',
    ]);
  });
});
