import type { Schemas } from '@vigil/shared';

/**
 * Delivery-target resolution per recipient body.
 *
 * Each body has its own SFTP server / inbox / ack directory / Vault key
 * mount. Configuration is env-driven so the per-deployment values stay out
 * of the codebase. Boot-time validation rejects PLACEHOLDER values for the
 * default body (CONAC) per DECISION-008 Tier-1; non-default bodies degrade
 * to a "park for later" retry rather than blocking startup, so the worker
 * can still ship CONAC dossiers while Cour des Comptes / MINFI / ANIF
 * agreements are pending.
 */

export interface DeliveryTarget {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly inboxPath: string;
  readonly ackPath: string;
  readonly vaultKeyMount: string;
}

const ENV_PREFIX: Record<Schemas.RecipientBody, string> = {
  CONAC: 'CONAC',
  COUR_DES_COMPTES: 'COUR_DES_COMPTES',
  MINFI: 'MINFI_SFTP',
  ANIF: 'ANIF_SFTP',
  CDC: 'CDC_SFTP',
  OTHER: 'OTHER_SFTP',
};

const DEFAULT_INBOX: Record<Schemas.RecipientBody, string> = {
  CONAC: '/inbox/vigil-apex',
  COUR_DES_COMPTES: '/inbox/vigil-apex',
  MINFI: '/inbox/risk-advisory',
  ANIF: '/inbox/declaration',
  CDC: '/inbox/vigil-apex',
  OTHER: '/inbox/vigil-apex',
};

const DEFAULT_ACK: Record<Schemas.RecipientBody, string> = {
  CONAC: '/ack/vigil-apex',
  COUR_DES_COMPTES: '/ack/vigil-apex',
  MINFI: '/ack/risk-advisory',
  ANIF: '/ack/declaration',
  CDC: '/ack/vigil-apex',
  OTHER: '/ack/vigil-apex',
};

const VAULT_KEY_MOUNT: Record<Schemas.RecipientBody, string> = {
  CONAC: 'conac-sftp',
  COUR_DES_COMPTES: 'cdc-sftp',
  MINFI: 'minfi-sftp',
  ANIF: 'anif-sftp',
  CDC: 'cdc-treasury-sftp',
  OTHER: 'other-sftp',
};

export class DeliveryTargetMisconfiguredError extends Error {
  constructor(body: Schemas.RecipientBody, key: string) {
    super(
      `Delivery target for ${body} is misconfigured: env ${key} is unset. Set the four vars ${key}_HOST, ${key}_PORT, ${key}_USER, and provision Vault mount '${VAULT_KEY_MOUNT[body]}'.`,
    );
    this.name = 'DeliveryTargetMisconfiguredError';
  }
}

export function resolveDeliveryTarget(body: Schemas.RecipientBody): DeliveryTarget {
  const prefix = ENV_PREFIX[body];
  const host = process.env[`${prefix}_SFTP_HOST`] ?? process.env[`${prefix}_HOST`];
  if (!host || host.trim() === '') {
    throw new DeliveryTargetMisconfiguredError(body, `${prefix}_SFTP_HOST`);
  }
  const portRaw = process.env[`${prefix}_SFTP_PORT`] ?? process.env[`${prefix}_PORT`] ?? '22';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new DeliveryTargetMisconfiguredError(body, `${prefix}_SFTP_PORT`);
  }
  const username =
    process.env[`${prefix}_SFTP_USER`] ?? process.env[`${prefix}_USER`] ?? 'vigilapex';
  const inboxPath = process.env[`${prefix}_INBOX`] ?? DEFAULT_INBOX[body];
  const ackPath = process.env[`${prefix}_ACK_DIR`] ?? DEFAULT_ACK[body];

  return {
    host,
    port,
    username,
    inboxPath,
    ackPath,
    vaultKeyMount: VAULT_KEY_MOUNT[body],
  };
}

/**
 * Boot-time check — refuse to start the worker if the *default* CONAC body
 * is misconfigured, since that's the everyday delivery path. Other bodies
 * are validated lazily when a dossier addressed to them appears, so an
 * unused integration doesn't block CONAC traffic.
 */
export function assertCriticalTargetsConfigured(): void {
  resolveDeliveryTarget('CONAC');
}
