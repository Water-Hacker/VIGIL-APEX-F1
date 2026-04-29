import { z } from 'zod';

/**
 * Wire payload from STREAMS.AUDIT_PUBLISH consumed by worker-fabric-bridge.
 * `seq` is accepted as either a string (BigInt-safe) or a number; both are
 * normalised to a string for the chaincode call.
 *
 * Lives in its own module so unit tests don't have to import the worker
 * entrypoint (which boots tracing + Redis + Fabric SDK at module load).
 */
export const zFabricBridgePayload = z.object({
  audit_event_id: z.string().uuid(),
  seq: z.union([z.string(), z.number()]).transform((v) => String(v)),
  body_hash: z.string().regex(/^[0-9a-f]{64}$/i),
});

export type FabricBridgePayload = z.infer<typeof zFabricBridgePayload>;
