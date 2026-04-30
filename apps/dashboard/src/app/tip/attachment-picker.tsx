'use client';

import { TipSanitise } from '@vigil/shared';
import { useCallback, useState } from 'react';

/**
 * <TipAttachmentPicker> — citizen-facing file picker for the /tip page.
 *
 * Pipeline per file:
 *
 *   1. File constructor honours the strict `accept` attribute (browser-
 *      level filter; not enough on its own — citizens can drag-drop or
 *      paste).
 *   2. Read the file's first 32 bytes; magic-byte detect via
 *      `TipSanitise.detectMimeFromMagic`. Reject if the detected MIME
 *      is null OR doesn't match the file's declared MIME.
 *   3. For images: re-encode through a `<canvas>` to PNG / JPEG. This
 *      drops EXIF (location), Adobe XMP, IPTC, ICC profile colour
 *      metadata, and any steganographic LSB payload that hasn't been
 *      ICC-corrected. The re-encoded bytes pass through magic-byte
 *      detection a second time before encryption.
 *   4. For video / pdf / audio: the bytes are accepted as-is (re-
 *      encoding video in-browser would corrupt evidence + balloon the
 *      bundle). Magic-byte gate has already confirmed the container.
 *   5. libsodium sealed-box encrypt with the operator-team public key
 *      (fetched at picker init time, cached for the page lifetime).
 *      The browser NEVER hands plaintext to the network.
 *   6. POST the ciphertext to `/api/tip/attachment` with
 *      `Content-Type: application/x-libsodium-sealed-box`. The server
 *      pins to IPFS and returns the CID.
 *   7. Add the CID + sanitised display-name to the parent's list.
 *
 * The component is purely additive — the existing tip-form text path is
 * unchanged. The parent owns the `cids` array; this component reports
 * additions + removals via an onChange callback.
 *
 * Accessibility:
 *   - File input has a visible label + descriptive helper text.
 *   - Per-file errors render in a polite `aria-live` region.
 *   - Keyboard-only operation works (Tab to focus the input,
 *     Enter to open file picker; remove buttons are real <button>s).
 */

interface AttachmentRecord {
  /** IPFS CID returned by /api/tip/attachment. */
  cid: string;
  /** Sanitised display-name shown to the user (NEVER sent to server). */
  displayName: string;
  /** Detected MIME (from magic bytes) — informational. */
  mime: TipSanitise.AllowedTipMime;
  /** Encrypted-ciphertext byte count. */
  bytes: number;
}

interface PickerProps {
  /** Cached operator-team public key (base64). Fetched by the parent
   *  page so the picker doesn't have to know about /api/tip/public-key. */
  operatorPublicKeyB64: string;
  /** Current attachment list — controlled by the parent so the form
   *  knows what to submit. */
  attachments: ReadonlyArray<AttachmentRecord>;
  /** Callback when the list changes. */
  onChange: (next: ReadonlyArray<AttachmentRecord>) => void;
  /** Optional label override. */
  label?: string;
  /** Maximum total bytes across all attachments (defaults to the
   *  shared limit, exposed for tests). */
  maxBytesPerSubmission?: number;
}

const ACCEPT_ATTR = TipSanitise.ALLOWED_MIME_TYPES.join(',');

export function TipAttachmentPicker({
  operatorPublicKeyB64,
  attachments,
  onChange,
  label = 'Pièces jointes / attachments (jpg, png, webp, mp4, webm, mp3, ogg, pdf)',
  maxBytesPerSubmission = TipSanitise.TIP_ATTACHMENT_LIMITS.maxBytesPerSubmission,
}: PickerProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [perFileError, setPerFileError] = useState<string | null>(null);

  const totalBytes = attachments.reduce((acc, a) => acc + a.bytes, 0);

  const handleAdd = useCallback(
    async (files: FileList | null): Promise<void> => {
      setPerFileError(null);
      if (!files || files.length === 0) return;
      if (attachments.length + files.length > TipSanitise.TIP_ATTACHMENT_LIMITS.maxFiles) {
        setPerFileError(
          `Maximum ${TipSanitise.TIP_ATTACHMENT_LIMITS.maxFiles} fichiers / files par soumission.`,
        );
        return;
      }
      setBusy(true);
      const additions: AttachmentRecord[] = [];
      try {
        const sodium = await import('libsodium-wrappers-sumo');
        await sodium.default.ready;
        const pk = sodium.default.from_base64(
          operatorPublicKeyB64,
          sodium.default.base64_variants.ORIGINAL,
        );
        for (const file of Array.from(files)) {
          const verdict = await processOne(file, pk, sodium.default);
          if (!verdict.ok) {
            setPerFileError(`${file.name}: ${verdict.reason}`);
            continue;
          }
          if (totalBytes + verdict.record.bytes > maxBytesPerSubmission) {
            setPerFileError(
              `Total dépasse ${(maxBytesPerSubmission / 1_048_576).toFixed(0)} MB; ${file.name} ignoré.`,
            );
            continue;
          }
          additions.push(verdict.record);
        }
        if (additions.length > 0) {
          onChange([...attachments, ...additions]);
        }
      } catch (e) {
        setPerFileError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [attachments, onChange, operatorPublicKeyB64, maxBytesPerSubmission, totalBytes],
  );

  const handleRemove = useCallback(
    (cid: string): void => {
      onChange(attachments.filter((a) => a.cid !== cid));
    },
    [attachments, onChange],
  );

  return (
    <div className="vigil-tip-attachments" data-busy={busy}>
      <label htmlFor="tip-attachments-input">{label}</label>
      <input
        id="tip-attachments-input"
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        disabled={busy || attachments.length >= TipSanitise.TIP_ATTACHMENT_LIMITS.maxFiles}
        onChange={(e) => {
          void handleAdd(e.target.files);
          e.target.value = ''; // allow re-adding the same file after remove
        }}
      />
      <p className="vigil-tip-help" style={{ color: 'var(--muted)', fontSize: 12 }}>
        Les images sont ré-encodées dans votre navigateur pour supprimer les métadonnées EXIF avant
        le chiffrement. Les vidéos sont vérifiées par signature binaire mais conservées telles
        quelles. Tout est chiffré localement; le serveur ne voit jamais le contenu en clair.
      </p>
      {busy && (
        <p role="status" aria-live="polite">
          Traitement / processing…
        </p>
      )}
      {perFileError && (
        <p role="alert" style={{ color: 'var(--error)' }}>
          {perFileError}
        </p>
      )}
      {attachments.length > 0 && (
        <ul className="vigil-tip-attachment-list" style={{ listStyle: 'none', padding: 0 }}>
          {attachments.map((a) => (
            <li
              key={a.cid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid var(--vigil-card-border)',
              }}
            >
              <span style={{ flex: 1 }}>
                <span className="font-mono">{a.displayName}</span>{' '}
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  ({a.mime} · {(a.bytes / 1024).toFixed(0)} KB · cid={a.cid.slice(0, 12)}…)
                </span>
              </span>
              <button
                type="button"
                onClick={() => handleRemove(a.cid)}
                aria-label={`remove ${a.displayName}`}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--vigil-card-border)',
                  color: 'var(--muted)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        {attachments.length}/{TipSanitise.TIP_ATTACHMENT_LIMITS.maxFiles} fichiers ·{' '}
        {(totalBytes / 1_048_576).toFixed(2)} / {(maxBytesPerSubmission / 1_048_576).toFixed(0)} MB
      </p>
    </div>
  );
}

/**
 * Process a single file end-to-end. Pure async; no React state inside.
 */
async function processOne(
  file: File,
  operatorPk: Uint8Array,
  // The libsodium-wrappers-sumo package exports a default that owns
  // the API surface; we type it as `any` here because the @types
  // package's type does not match the runtime export shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sodium: any,
): Promise<{ ok: true; record: AttachmentRecord } | { ok: false; reason: string }> {
  const declaredMime = file.type || 'application/octet-stream';

  // 1. Read raw bytes (only the header for the magic-byte check first;
  // we read the full body below if the gate passes).
  const arrayBuf = await file.arrayBuffer();
  // Widen to `Uint8Array<ArrayBufferLike>` so subsequent assignments
  // from a re-encoded buffer don't trigger TS's narrow-vs-wide
  // ArrayBuffer-generic mismatch.
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(arrayBuf);

  // 2. Validate against the closed allow-list + magic bytes.
  const gate = TipSanitise.validateAttachment({
    filename: file.name,
    declaredMime,
    bytes,
  });
  if (!gate.ok) {
    return { ok: false, reason: gate.reason };
  }

  // 3. For images: re-encode through canvas to drop EXIF + ICC + IPTC.
  if (gate.mime === 'image/jpeg' || gate.mime === 'image/png' || gate.mime === 'image/webp') {
    try {
      const reencoded = await reencodeImage(bytes, gate.mime);
      bytes = reencoded as Uint8Array;
    } catch {
      return { ok: false, reason: 'image-reencode-failed' };
    }
    // Re-validate after re-encode.
    const gate2 = TipSanitise.validateAttachment({
      filename: gate.sanitisedFilename,
      declaredMime: gate.mime,
      bytes,
    });
    if (!gate2.ok) {
      return { ok: false, reason: 'reencoded-bytes-failed-gate' };
    }
  }

  // 4. libsodium sealed-box encrypt to operator key.
  const ciphertext = sodium.crypto_box_seal(bytes, operatorPk);

  // 5. Upload to /api/tip/attachment.
  const res = await fetch('/api/tip/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-libsodium-sealed-box' },
    body: new Blob([ciphertext]),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: err.error ?? `upload-http-${res.status}` };
  }
  const j = (await res.json()) as { cid: string; bytes: number };

  return {
    ok: true,
    record: {
      cid: j.cid,
      displayName: gate.sanitisedFilename,
      mime: gate.mime,
      bytes: j.bytes,
    },
  };
}

/**
 * Re-encode an image via a 2D canvas to strip EXIF + ICC + IPTC metadata.
 *
 * Approach:
 *   1. Decode bytes via createImageBitmap (fast, off-main-thread when
 *      supported by the browser).
 *   2. Draw onto a new OffscreenCanvas / HTMLCanvasElement.
 *   3. canvas.convertToBlob({ type: targetMime, quality: 0.92 }) gives
 *      us the re-encoded blob.
 *
 * Quality=0.92 preserves perceptual fidelity for evidence photos while
 * still dropping invisible payloads. PNG ignores the quality param.
 */
async function reencodeImage(input: Uint8Array, targetMime: string): Promise<Uint8Array> {
  // The Blob constructor takes a BufferSource; createImageBitmap
  // accepts a Blob. Copy into a fresh ArrayBuffer to satisfy the
  // BlobPart contract (TS-strict environments reject SharedArrayBuffer
  // here even though the runtime accepts it).
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  const bitmap = await createImageBitmap(new Blob([copy]));
  const w = bitmap.width;
  const h = bitmap.height;
  // Cap dimensions to avoid a malicious input that would explode RAM
  // when re-encoded (a 50_000 × 50_000 PNG ≈ 10 GB raw).
  if (w > 8192 || h > 8192) {
    bitmap.close?.();
    throw new Error('image-dimensions-too-large');
  }
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-2d-unavailable');
    ctx.drawImage(bitmap, 0, 0);
    blob = await canvas.convertToBlob({ type: targetMime, quality: 0.92 });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-2d-unavailable');
    ctx.drawImage(bitmap, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas-toBlob-null'))),
        targetMime,
        0.92,
      );
    });
  }
  bitmap.close?.();
  return new Uint8Array(await blob.arrayBuffer());
}
