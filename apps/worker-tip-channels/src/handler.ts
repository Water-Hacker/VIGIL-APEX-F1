import { randomUUID } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import { z } from 'zod';

import {
  encryptIncomingTip,
  formatTipReference,
  reassembleUssdSegments,
  resolveLanguage,
  voiceToIncoming,
  type IncomingTipDescriptor,
  type TipChannel,
  type TipLanguage,
} from './tip-channels.js';

import type { TipRepo } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { Envelope, HandlerOutcome } from '@vigil/queue';

/**
 * Inbound payload schema — what MTN / Orange / IVR gateways post over
 * the webhook bridge. The bridge converts the operator-specific
 * webhook payload to this canonical shape before writing to
 * `STREAMS.TIP_CHANNELS_INCOMING`.
 *
 * USSD: `kind='ussd'`, `ussd_segments` carries the multi-segment input.
 * SMS:  `kind='sms'`, `sms_body` carries the body.
 * Voice: `kind='voice'`, `voice_transcription` carries the Whisper output.
 */
export const zTipChannelsPayload = z.object({
  kind: z.enum(['ussd', 'sms', 'voice']),
  language: z
    .enum(['fr', 'en', 'ful', 'ewo', 'dua', 'bbj', 'cpe'])
    .or(z.string())
    .transform((v) => resolveLanguage(typeof v === 'string' ? v : 'fr')),
  region: z.enum(['AD', 'CE', 'EN', 'ES', 'LT', 'NO', 'NW', 'OU', 'SU', 'SW']).optional(),
  gateway_request_id: z.string().min(1).max(200),
  gateway_at: z.string().datetime({ offset: true }),
  ussd_segments: z
    .array(z.object({ index: z.number().int().nonnegative(), text: z.string().max(160) }))
    .max(20)
    .optional(),
  sms_body: z.string().min(1).max(20_000).optional(),
  voice_transcription: z
    .object({
      transcription_text: z.string().min(1).max(20_000),
      language: z.enum(['fr', 'en', 'ful', 'ewo', 'dua', 'bbj', 'cpe']),
      confidence: z.number().min(0).max(1),
      duration_seconds: z.number().min(0).max(900),
    })
    .optional(),
});
export type TipChannelsPayload = z.infer<typeof zTipChannelsPayload>;

export interface TipChannelsContext {
  readonly tipRepo: TipRepo;
  readonly councilPublicKeyB64: string;
  readonly chain: HashChain;
  readonly logger: Logger;
  readonly now?: () => Date;
}

/**
 * Convert the wire payload to the canonical IncomingTipDescriptor. Pure;
 * exported separately so the unit-test suite can exercise the conversion
 * without spinning up the queue/DB layer.
 */
export function descriptorFromPayload(payload: TipChannelsPayload): IncomingTipDescriptor {
  const language: TipLanguage = resolveLanguage(payload.language);
  switch (payload.kind) {
    case 'ussd': {
      const segments = payload.ussd_segments ?? [];
      if (segments.length === 0) {
        throw new Error('descriptorFromPayload: ussd kind requires ussd_segments');
      }
      const body = reassembleUssdSegments(segments);
      return {
        channel: 'ussd',
        language,
        body_plaintext: body,
        gateway_request_id: payload.gateway_request_id,
        gateway_at: payload.gateway_at,
      };
    }
    case 'sms': {
      if (!payload.sms_body) {
        throw new Error('descriptorFromPayload: sms kind requires sms_body');
      }
      return {
        channel: 'sms',
        language,
        body_plaintext: payload.sms_body,
        gateway_request_id: payload.gateway_request_id,
        gateway_at: payload.gateway_at,
      };
    }
    case 'voice': {
      if (!payload.voice_transcription) {
        throw new Error('descriptorFromPayload: voice kind requires voice_transcription');
      }
      return voiceToIncoming(payload.voice_transcription, {
        request_id: payload.gateway_request_id,
        at: payload.gateway_at,
      });
    }
  }
}

/**
 * Idempotent end-to-end handler:
 *   1. Convert payload → IncomingTipDescriptor
 *   2. Sealed-box encrypt against the council pubkey
 *   3. Allocate a per-year tip reference TIP-YYYY-NNNN
 *   4. Persist via TipRepo.insert (DB-level append-only trigger guards
 *      against tampering per DECISION-016)
 *   5. Append an audit-chain row carrying only channel + language +
 *      ciphertext byte length (NEVER plaintext, NEVER MSISDN)
 *
 * Idempotency: at-least-once delivery is handled by the queue base via
 * dedup_key; this handler does its own additional guard by treating a
 * unique constraint violation on `tip.ref` as a successful no-op (the
 * prior delivery already committed; safe to ACK).
 */
export async function handleTipChannelsEvent(
  ctx: TipChannelsContext,
  env: Envelope<TipChannelsPayload>,
): Promise<HandlerOutcome> {
  const now = ctx.now ?? (() => new Date());
  let descriptor: IncomingTipDescriptor;
  try {
    descriptor = descriptorFromPayload(env.payload);
  } catch (err) {
    ctx.logger.error({ err: (err as Error).message }, 'tip-channels-bad-payload');
    return { kind: 'dead-letter', reason: `bad payload: ${(err as Error).message}` };
  }

  const channel: TipChannel = descriptor.channel;
  const language: TipLanguage = descriptor.language;

  let encrypted: Awaited<ReturnType<typeof encryptIncomingTip>>;
  try {
    encrypted = await encryptIncomingTip(descriptor, ctx.councilPublicKeyB64, now());
  } catch (err) {
    return { kind: 'dead-letter', reason: `encrypt: ${(err as Error).message}` };
  }

  const cipherBuf = Buffer.from(encrypted.body_ciphertext_b64, 'base64');
  const year = now().getUTCFullYear();
  const seq = await ctx.tipRepo.nextRefSeqForYear(year);
  const ref = formatTipReference(year, seq);

  try {
    await ctx.tipRepo.insert({
      id: randomUUID(),
      ref,
      disposition: 'NEW',
      body_ciphertext: cipherBuf,
      contact_ciphertext: null,
      attachment_cids: [],
      topic_hint: `channel:${channel}`,
      region: env.payload.region ?? null,
      received_at: now(),
      triaged_at: null,
      triaged_by: null,
      promoted_finding_id: null,
      triage_notes_ciphertext: null,
    });
  } catch (err) {
    const msg = (err as Error).message.toLowerCase();
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      ctx.logger.info({ ref }, 'tip-channels-duplicate-ack');
      return { kind: 'ack' };
    }
    ctx.logger.error({ err: (err as Error).message }, 'tip-channels-persist-error');
    return { kind: 'retry', reason: 'persist failed', delay_ms: 2_000 };
  }

  await ctx.chain.append({
    action: 'audit.tip_received_channel',
    actor: 'system:worker-tip-channels',
    subject_kind: 'tip',
    subject_id: ref,
    payload: {
      channel,
      language,
      ciphertext_bytes: cipherBuf.length,
      gateway_request_id: env.payload.gateway_request_id,
      correlation_id: env.correlation_id,
    },
  });

  ctx.logger.info(
    { ref, channel, language, ciphertext_bytes: cipherBuf.length },
    'tip-channels-persisted',
  );
  return { kind: 'ack' };
}
