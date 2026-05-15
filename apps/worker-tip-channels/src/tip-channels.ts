/**
 * Pure tip-channel logic for USSD / SMS / voice ingestion.
 *
 * Closes FRONTIER-AUDIT Layer-1 E1.4: the browser-only tip portal
 * excludes the population the platform exists to serve — rural
 * feature-phone users, illiterate users, non-FR/EN speakers.
 *
 * Three channels covered:
 *
 *   1. **USSD** — short-code-initiated menu session over GSM.
 *      Citizen dials `*333#`, gets a menu in their declared
 *      language, types observation in 20-160-char segments. Each
 *      segment is reassembled at the gateway, encrypted server-side
 *      against the council public key, persisted with same schema as
 *      browser tips.
 *
 *   2. **SMS** — citizen sends an SMS to the dedicated short code.
 *      Body text is encrypted server-side. Reply SMS confirms
 *      with the tip reference `TIP-YYYY-NNNN`.
 *
 *   3. **Voice** — citizen calls the short code, IVR plays prompts
 *      in declared language, records audio. Audio is transcribed
 *      server-side (Whisper) with the resulting text encrypted as
 *      above. Audio is destroyed after transcription per the
 *      privacy doctrine.
 *
 * **Critical privacy property**: in all three channels the citizen
 * never gives the server an ID, email, phone-derived signature, or
 * persistent identifier. The MSISDN (phone number) is used only by
 * the telecom gateway for delivery routing and is **not forwarded**
 * to VIGIL APEX. The encrypted blob persisted to the application
 * database has no link back to the originating SIM.
 *
 * Browser-side libsodium and server-side libsodium produce
 * byte-identical sealed-box outputs (X25519 + XChaCha20-Poly1305),
 * so a USSD-submitted tip is indistinguishable to the council
 * decryption ceremony from a browser-submitted tip.
 *
 * Supported declared languages (per declared language code):
 *
 *   - fr (Français — primary)
 *   - en (English)
 *   - ful (Fulfulde — Adamawa + North + Far North regions)
 *   - ewo (Ewondo — Centre region)
 *   - dua (Duala — Littoral region)
 *   - bbj (Ghomálá / Bamileke dialects cluster)
 *   - cpe (Cameroonian Pidgin English — North-West + South-West)
 *
 * Translations of the menu prompts are not in this module — they
 * live in `src/menus.ts` (FR + EN ready today, others Phase-2 work
 * blocked on counsel + native-speaker review of consent language).
 */

import { sealedBoxEncrypt } from '@vigil/security';

export type TipChannel = 'ussd' | 'sms' | 'voice';

export type TipLanguage = 'fr' | 'en' | 'ful' | 'ewo' | 'dua' | 'bbj' | 'cpe';

export interface IncomingTipDescriptor {
  readonly channel: TipChannel;
  readonly language: TipLanguage;
  /** Plaintext body — the text the citizen entered or the Whisper
   *  transcription of their voice recording. NEVER LOGGED. */
  readonly body_plaintext: string;
  /** Telecom gateway's request-id (used only for gateway-side
   *  delivery confirmation; not stored). */
  readonly gateway_request_id: string;
  /** Telecom gateway timestamp. */
  readonly gateway_at: string;
}

export interface EncryptedTipForPersistence {
  readonly channel: TipChannel;
  readonly language: TipLanguage;
  readonly body_ciphertext_b64: string;
  readonly received_at: string;
}

/**
 * Encrypt an incoming tip via libsodium sealed-box against the
 * provided council public key (32-byte X25519 public key, base64).
 *
 * Pure function — no I/O. Caller is responsible for fetching the
 * public key from Vault, persisting the result to Postgres, and
 * dropping `body_plaintext` from memory immediately after the call
 * returns.
 */
export async function encryptIncomingTip(
  desc: IncomingTipDescriptor,
  councilPublicKeyB64: string,
  now: Date = new Date(),
): Promise<EncryptedTipForPersistence> {
  if (desc.body_plaintext.length === 0) {
    throw new Error('encryptIncomingTip: empty body_plaintext refused');
  }
  if (desc.body_plaintext.length > 200_000) {
    throw new Error('encryptIncomingTip: body exceeds 200KB cap');
  }
  const cipher = await sealedBoxEncrypt(desc.body_plaintext, councilPublicKeyB64);
  return {
    channel: desc.channel,
    language: desc.language,
    body_ciphertext_b64: cipher,
    received_at: now.toISOString(),
  };
}

/**
 * Reassemble multi-segment USSD input. USSD has a 160-character
 * payload limit; long observations come as N segments. The gateway
 * groups them by session ID before calling this; this function
 * validates ordering and joins.
 */
export function reassembleUssdSegments(
  segments: ReadonlyArray<{ index: number; text: string }>,
): string {
  if (segments.length === 0) return '';
  const sorted = [...segments].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.index !== i) {
      throw new Error(`USSD segment index mismatch: expected ${i}, got ${sorted[i]!.index}`);
    }
  }
  return sorted.map((s) => s.text).join('');
}

/**
 * Validate that a declared language code is one we support.
 * Citizens who declare an unsupported language get fr (default).
 */
export function resolveLanguage(declared: string | undefined): TipLanguage {
  const known: ReadonlyArray<TipLanguage> = ['fr', 'en', 'ful', 'ewo', 'dua', 'bbj', 'cpe'];
  if (declared && (known as ReadonlyArray<string>).includes(declared)) {
    return declared as TipLanguage;
  }
  return 'fr';
}

/**
 * Tip reference generator — same format as browser portal so an
 * operator triaging at /triage/tips cannot distinguish channel from
 * the ref alone.
 *
 * `TIP-YYYY-NNNN` where NNNN is sequence; YYYY is calendar year.
 * The counter is per-year and persisted in Postgres; this helper
 * just formats it.
 */
export function formatTipReference(year: number, sequence: number): string {
  const yy = year.toString().padStart(4, '0');
  const nn = sequence.toString().padStart(4, '0');
  return `TIP-${yy}-${nn}`;
}

/**
 * Whisper transcription input (voice channel only). The audio
 * pipeline is opaque from this module's perspective; the audio
 * never reaches VIGIL APEX servers — Whisper is run inside the
 * citizen-facing IVR gateway provided by the telecom partner, with
 * the gateway returning the transcription only. This keeps audio
 * outside the platform's threat surface entirely.
 */
export interface VoiceTipTranscription {
  readonly transcription_text: string;
  readonly language: TipLanguage;
  readonly confidence: number;
  readonly duration_seconds: number;
}

/**
 * Convert a voice transcription to an IncomingTipDescriptor for
 * downstream encryption. Refuses if Whisper confidence is below
 * threshold (default 0.65) — operator triage flags low-confidence
 * transcriptions for human listen-back (separately handled by the
 * gateway, with the audio destroyed in 24 hours).
 */
export function voiceToIncoming(
  transcription: VoiceTipTranscription,
  gateway: { request_id: string; at: string },
  confidenceThreshold = 0.65,
): IncomingTipDescriptor {
  if (transcription.confidence < confidenceThreshold) {
    throw new Error(
      `voice transcription confidence ${transcription.confidence} below threshold ${confidenceThreshold}`,
    );
  }
  if (transcription.transcription_text.trim().length === 0) {
    throw new Error('voice transcription produced empty text');
  }
  return {
    channel: 'voice',
    language: transcription.language,
    body_plaintext: transcription.transcription_text,
    gateway_request_id: gateway.request_id,
    gateway_at: gateway.at,
  };
}
