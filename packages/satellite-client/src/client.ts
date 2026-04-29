import { QueueClient, newEnvelope } from '@vigil/queue';
import { Ids } from '@vigil/shared';

import { zSatelliteRequest, type SatelliteRequest } from './types.js';

export const SATELLITE_REQUEST_STREAM = 'vigil:satellite:request';

/**
 * Returns the deterministic dedup key used by SatelliteClient.request().
 * The trigger adapter calls this before insert so the same key is recorded
 * in `dossier.satellite_request` for idempotency across restarts.
 */
export function satelliteRequestKey(input: {
  projectId: string | null;
  findingId: string | null;
  contractStart: string;
  contractEnd: string;
}): string {
  const subject = input.projectId ?? input.findingId ?? 'unknown';
  return `sat:${subject}:${input.contractStart.slice(0, 10)}:${input.contractEnd.slice(0, 10)}`;
}

export class SatelliteClient {
  constructor(private readonly queue: QueueClient) {}

  /**
   * Validates and publishes a SatelliteRequest. Returns the deterministic
   * `request_id` (used as the dedup key) so callers can persist it in their
   * tracking row before the worker picks it up.
   */
  async request(req: SatelliteRequest): Promise<{ requestId: string; dedupKey: string }> {
    const validated = zSatelliteRequest.parse(req);
    const dedupKey = satelliteRequestKey({
      projectId: validated.project_id,
      findingId: validated.finding_id,
      contractStart: validated.contract_window.start,
      contractEnd: validated.contract_window.end,
    });
    const env = newEnvelope('satellite-client', validated, dedupKey);
    await this.queue.publish(SATELLITE_REQUEST_STREAM, env);
    return { requestId: validated.request_id, dedupKey };
  }

  /** Helper that mints a fresh request_id from Ids and forwards to request(). */
  async requestNew(
    payload: Omit<SatelliteRequest, 'request_id'>,
  ): Promise<{ requestId: string; dedupKey: string }> {
    const requestId = Ids.newEventId();
    return this.request({ ...payload, request_id: requestId });
  }
}
