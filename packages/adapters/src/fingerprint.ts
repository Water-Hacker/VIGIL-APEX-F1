/**
 * Browser fingerprint discipline (SRD §13.5).
 *
 * We do NOT impersonate browsers we are not. We use Playwright's actual Chromium
 * UA string and rotate viewport / timezone / language only. We DO NOT rotate
 * Canvas/WebGL fingerprints — sites that fingerprint at that depth will block
 * us regardless and that's a finding category G signal.
 */

import { Constants } from '@vigil/shared';

export interface FingerprintProfile {
  readonly userAgent: string;
  readonly viewport: { width: number; height: number };
  readonly timezone: string;
  readonly locale: 'fr-CM' | 'en-CM' | 'fr-FR' | 'en-US';
  readonly acceptLanguage: string;
}

const VIEWPORT_POOL: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

export function pickFingerprint(seed?: string): FingerprintProfile {
  const i = seed ? hashToInt(seed) : Math.floor(Math.random() * VIEWPORT_POOL.length);
  return {
    userAgent: Constants.ADAPTER_DEFAULT_USER_AGENT,
    viewport: VIEWPORT_POOL[i % VIEWPORT_POOL.length]!,
    timezone: 'Africa/Douala',
    locale: i % 2 === 0 ? 'fr-CM' : 'en-CM',
    acceptLanguage: i % 2 === 0 ? 'fr-CM,fr;q=0.9,en;q=0.5' : 'en-CM,en;q=0.9,fr;q=0.5',
  };
}

function hashToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
