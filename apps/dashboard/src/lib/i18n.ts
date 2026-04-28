import { cookies, headers } from 'next/headers';

/**
 * Minimal i18n surface (Phase C2). FR is primary (Cameroon official
 * language; SRD §28.10 mandates FR as the canonical dossier text), EN is
 * secondary. The locale is resolved per request from, in order:
 *   1. `vigil_lang` cookie (operator-selected override)
 *   2. `Accept-Language` header
 *   3. fallback 'fr'
 *
 * Server components import `getLocale()` and `t(messages, key)`. Client
 * components receive messages as a prop from their server parent — we
 * don't ship the full bundle to the browser unless the page needs it.
 */

export type Locale = 'fr' | 'en';
export const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ['fr', 'en'];
export const DEFAULT_LOCALE: Locale = 'fr';

export function getLocale(): Locale {
  const cookie = cookies().get('vigil_lang')?.value;
  if (cookie === 'fr' || cookie === 'en') return cookie;

  const accept = headers().get('accept-language') ?? '';
  // Cheap parse — first language tag, language subtag only.
  const first = accept.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
  if (first === 'fr' || first === 'en') return first;

  return DEFAULT_LOCALE;
}

export type Messages = Record<string, string>;

export async function loadMessages(locale: Locale): Promise<Messages> {
  // Static imports are tree-shaken by Next; switch on the literal locale.
  if (locale === 'en') {
    return (await import('../../messages/en.json')).default as Messages;
  }
  return (await import('../../messages/fr.json')).default as Messages;
}

/**
 * Lookup with `{var}` interpolation. Missing keys log a warning in dev
 * and fall back to the key string itself — visible but not crashing.
 */
export function t(messages: Messages, key: string, vars?: Record<string, string | number>): string {
  const raw = messages[key];
  if (raw === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
}
