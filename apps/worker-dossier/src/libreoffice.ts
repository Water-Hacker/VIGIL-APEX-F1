/**
 * T3 of TODO.md sweep — extract worker-dossier's LibreOffice +
 * size-cap + signature-fingerprint helpers to a testable module so
 * the worker class doesn't need to be instantiated (and its
 * kubo/DossierRepo/EntityRepo/renderDossierDocx deps mocked) just to
 * exercise the render-boundary guards.
 *
 * No behavioural change: the helpers are the same logic that lived in
 * src/index.ts at the time of extraction. The index.ts file is updated
 * in the same commit to import from this module.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/**
 * Tier-58 audit closure — hard cap on PDF size. LibreOffice can produce
 * pathologically large PDFs under font-fallback or embedded-image
 * bugs; a 100 MB PDF would OOM the worker and stall the IPFS pin.
 * 50 MiB is generous for a real bilingual dossier (typical: 200-500 KiB).
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Throws if `pdfBytes` exceeds `MAX_PDF_BYTES`. Pure; testable; the
 * thrown error message names the actual byte count + the cap so the
 * operator log surfaces both numbers.
 */
export function assertPdfWithinCap(pdfByteLength: number): void {
  if (pdfByteLength > MAX_PDF_BYTES) {
    throw new Error(
      `LibreOffice produced an oversized PDF: ${pdfByteLength} bytes > cap ${MAX_PDF_BYTES}`,
    );
  }
}

/**
 * Tier-12 council-dossier audit closure: hard wall-clock cap on the
 * LibreOffice headless convert. Pre-fix the spawn had no timeout — a
 * hung soffice (font fallback loop, X server vestige, libreoffice
 * background sync) would block the dossier worker indefinitely. With
 * `concurrency: 2`, two hung renders would stall the entire dossier
 * pipeline.
 *
 * 90 s is generous for any realistic dossier (typical render: 3–8 s,
 * 95th percentile on heavily-formatted bilingual docs: ~20 s). Anything
 * above that cap is presumed pathological; kill the child + reject so
 * the worker retries on the queue with a fresh process.
 *
 * Defaults to env LIBREOFFICE_TIMEOUT_MS so operators can dial it
 * without redeploying.
 */
export const DEFAULT_LIBREOFFICE_TIMEOUT_MS = Number(process.env.LIBREOFFICE_TIMEOUT_MS ?? 90_000);

/**
 * Tier-58 audit closure — capture stderr so non-zero exit codes carry
 * the soffice diagnostic message into the operator log. Pre-fix, the
 * reject error was just "soffice exited N" with no signal about WHY
 * (missing font, corrupt docx, fontconfig misuse). Bound the capture
 * at 4 KB so a verbose-mode soffice can't blow up worker memory.
 */
export const STDERR_CAP_BYTES = 4096;

export interface RunLibreOfficeOptions {
  /** Override the wall-clock timeout (ms). Defaults to DEFAULT_LIBREOFFICE_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Test-injectable spawn. Defaults to node:child_process spawn. */
  readonly spawnImpl?: SpawnLike;
}

/**
 * Structural shape of node:child_process spawn that we actually use —
 * narrowed to two positional args (command, argv) so a test can pass a
 * minimal stub without satisfying the full overload set.
 */
export type SpawnLike = (
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: SpawnOptions,
) => ChildProcess;

/**
 * Run `soffice --headless --convert-to pdf` on `docxPath` writing to
 * `outDir`. Resolves on exit code 0; rejects with a stderr-tail-bearing
 * error on non-zero exit OR on timeout (SIGKILL).
 */
export function runLibreOffice(
  docxPath: string,
  outDir: string,
  opts: RunLibreOfficeOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LIBREOFFICE_TIMEOUT_MS;
  const spawnFn: SpawnLike = opts.spawnImpl ?? ((cmd, args, o) => spawn(cmd, [...args], o ?? {}));
  return new Promise((resolve, reject) => {
    const child = spawnFn('soffice', [
      '--headless',
      '--convert-to',
      'pdf:writer_pdf_Export:UseTaggedPDF=false;ExportFormFields=false;ReduceImageResolution=false',
      '--outdir',
      outDir,
      docxPath,
    ]);
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < STDERR_CAP_BYTES) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stderrPreview = Buffer.concat(stderrChunks).toString('utf8').slice(0, STDERR_CAP_BYTES);
      if (timedOut) {
        reject(
          new Error(
            `soffice exceeded ${timeoutMs}ms timeout (SIGKILLed); stderr: ${stderrPreview || '<empty>'}`,
          ),
        );
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`soffice exited ${code}; stderr: ${stderrPreview || '<empty>'}`));
    });
  });
}

/**
 * Compute the dev-unsigned signature fingerprint per the worker's
 * fallback policy. Pure; used in src/index.ts after gpgDetachSign
 * fails AND the operator has explicitly opted into the dev fallback.
 *
 * The "DEV-UNSIGNED-" prefix is load-bearing: downstream
 * worker-conac-sftp refuses to deliver any dossier whose signature
 * fingerprint starts with that prefix (tier-1 audit closure).
 */
export function computeDevUnsignedFingerprint(baseFingerprint: string): string {
  return `DEV-UNSIGNED-${baseFingerprint}`;
}

/**
 * Return true if the runtime environment permits the dev-unsigned
 * dossier fallback. The combination is intentionally restrictive:
 * - VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER=true (explicit opt-in)
 * - NODE_ENV !== 'production' (never in prod, even with opt-in)
 * - VIGIL_PHASE < 1 (only Phase 0 dev / dry-run)
 */
export function devUnsignedAllowed(envv: NodeJS.ProcessEnv = process.env): boolean {
  return (
    envv.VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER === 'true' &&
    envv.NODE_ENV !== 'production' &&
    Number(envv.VIGIL_PHASE ?? '0') < 1
  );
}
