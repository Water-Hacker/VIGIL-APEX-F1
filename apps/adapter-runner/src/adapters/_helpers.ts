import { createHash } from 'node:crypto';

import { pickFingerprint, type AdapterRunContext } from '@vigil/adapters';
import { Constants, Errors, type Schemas } from '@vigil/shared';
import { chromium, type Browser } from 'playwright';
import { z } from 'zod';

import { boundedBodyText, boundedRequest } from './_bounded-fetch';

/**
 * Shared adapter helpers — keeps the 21 fill-in adapters thin.
 *
 * Three reusable harnesses are exposed:
 *   - playwrightFetch — Playwright Chromium GET, returns html + status
 *   - apiJsonFetch    — undici GET, parses + Zod-validates JSON
 *   - pdfLinkScrape   — undici GET HTML, extracts PDF links via regex
 *
 * Each one routes errors through the canonical Errors.* classes so the
 * adapter base + run-one path classify them correctly.
 */

const proxyArg = (ctx: AdapterRunContext): { server: string } | undefined =>
  ctx.proxy?.url ? { server: ctx.proxy.url } : undefined;

export interface PlaywrightFetchResult {
  readonly html: string;
  readonly status: number;
  readonly url: string;
  readonly fingerprint: ReturnType<typeof pickFingerprint>;
}

export async function playwrightFetch(
  ctx: AdapterRunContext,
  sourceId: string,
  url: string,
  waitSelector?: string,
): Promise<PlaywrightFetchResult> {
  const fp = pickFingerprint(sourceId);
  const launchOpts = proxyArg(ctx);
  const browser: Browser = await chromium.launch({
    headless: true,
    ...(launchOpts && { proxy: launchOpts }),
  });
  try {
    const browserCtx = await browser.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      locale: fp.locale,
      timezoneId: fp.timezone,
      extraHTTPHeaders: { 'Accept-Language': fp.acceptLanguage },
    });
    const page = await browserCtx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!resp) throw new Errors.SourceUnavailableError(sourceId, 0, { url });
    const status = resp.status();
    if (status === 403 || status === 451) {
      throw new Errors.SourceBlockedError(sourceId, { url, status });
    }
    if (status >= 500) {
      throw new Errors.SourceUnavailableError(sourceId, status, { url });
    }
    if (waitSelector !== undefined) {
      await page.waitForSelector(waitSelector, { timeout: 30_000 }).catch(() => null);
    }
    const html = await page.content();
    return { html, status, url, fingerprint: fp };
  } finally {
    await browser.close();
  }
}

/** Generic Playwright row scrape — yields events for every `tr` / `.item` row. */
export async function playwrightTableScrape(
  ctx: AdapterRunContext,
  sourceId: string,
  url: string,
  selector = 'table tbody tr, .liste .item',
): Promise<{
  rows: ReadonlyArray<{ text: string; cells: string[]; href: string | null }>;
  status: number;
  fp: ReturnType<typeof pickFingerprint>;
  responseSha: string;
}> {
  const fp = pickFingerprint(sourceId);
  const browser = await chromium.launch({
    headless: true,
    ...(ctx.proxy?.url ? { proxy: { server: ctx.proxy.url } } : {}),
  });
  try {
    const browserCtx = await browser.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      locale: fp.locale,
      timezoneId: fp.timezone,
    });
    const page = await browserCtx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!resp) throw new Errors.SourceUnavailableError(sourceId, 0, { url });
    const status = resp.status();
    if (status === 403 || status === 451) {
      throw new Errors.SourceBlockedError(sourceId, { url, status });
    }
    if (status >= 500) {
      throw new Errors.SourceUnavailableError(sourceId, status, { url });
    }
    await page.waitForSelector(selector, { timeout: 25_000 }).catch(() => null);
    const html = await page.content();
    const rows = await page.$$eval(selector, (els) =>
      els.map((row) => ({
        text: (row.textContent ?? '').trim().replace(/\s+/g, ' '),
        cells: Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
        href: (row.querySelector('a') as HTMLAnchorElement | null)?.href ?? null,
      })),
    );
    if (rows.length === 0) {
      throw new Errors.SourceParseError(sourceId, { url, html: html.slice(0, 200_000) });
    }
    const responseSha = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    return { rows, status, fp, responseSha };
  } finally {
    await browser.close();
  }
}

export async function apiJsonFetch<T>(
  ctx: AdapterRunContext,
  sourceId: string,
  url: string,
  schema: z.ZodType<T>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<{ data: T; status: number; responseSha: string; rawText: string }> {
  const headers: Record<string, string> = {
    'user-agent': Constants.getAdapterUserAgent(),
    accept: 'application/json',
    ...extraHeaders,
  };
  if (ctx.proxy?.url) {
    // undici pool/proxy is configured at the `Agent` layer; for adapter-runner
    // we honour proxy at the env-var layer (HTTPS_PROXY) which Bright Data sets.
  }
  const resp = await boundedRequest(url, { method: 'GET', headers });
  if (resp.statusCode === 403 || resp.statusCode === 451) {
    throw new Errors.SourceBlockedError(sourceId, { url, status: resp.statusCode });
  }
  if (resp.statusCode >= 500) {
    throw new Errors.SourceUnavailableError(sourceId, resp.statusCode, { url });
  }
  const text = await boundedBodyText(resp.body, { sourceId, url });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Errors.SourceParseError(sourceId, { url, html: text.slice(0, 100_000) });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Errors.SourceParseError(sourceId, {
      url,
      html: text.slice(0, 100_000),
      issues: JSON.stringify(result.error.issues.slice(0, 5)),
    });
  }
  return {
    data: result.data,
    status: resp.statusCode,
    responseSha: createHash('sha256').update(text).digest('hex'),
    rawText: text,
  };
}

export async function pdfLinkScrape(
  ctx: AdapterRunContext,
  sourceId: string,
  url: string,
): Promise<{
  links: ReadonlyArray<{ href: string; title: string }>;
  status: number;
  responseSha: string;
}> {
  const fp = pickFingerprint(sourceId);
  const resp = await boundedRequest(url, {
    method: 'GET',
    headers: { 'user-agent': fp.userAgent, 'accept-language': fp.acceptLanguage },
  });
  if (resp.statusCode === 403 || resp.statusCode === 451) {
    throw new Errors.SourceBlockedError(sourceId, { url, status: resp.statusCode });
  }
  if (resp.statusCode >= 500) {
    throw new Errors.SourceUnavailableError(sourceId, resp.statusCode, { url });
  }
  const html = await boundedBodyText(resp.body, { sourceId, url });
  const responseSha = createHash('sha256').update(html).digest('hex');
  const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]+)<\/a>/gi;
  const links: { href: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  const base = new URL(url);
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]!;
    const href = raw.startsWith('http') ? raw : new URL(raw, base).toString();
    links.push({ href, title: m[2]!.trim() });
  }
  if (links.length === 0) {
    throw new Errors.SourceParseError(sourceId, { url, html: html.slice(0, 200_000) });
  }
  return { links, status: resp.statusCode, responseSha };
}

/** Provenance shape used by every adapter. */
export function provenance(
  url: string,
  status: number,
  responseSha: string,
  ctx: AdapterRunContext,
  ua: string = Constants.getAdapterUserAgent(),
): Schemas.SourceEvent['provenance'] {
  return {
    url,
    http_status: status,
    response_sha256: responseSha,
    fetched_via_proxy: ctx.proxy?.url ?? null,
    user_agent: ua,
  };
}
