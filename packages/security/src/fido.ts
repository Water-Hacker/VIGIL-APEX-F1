import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

import { Errors } from '@vigil/shared';

/**
 * FIDO2 / WebAuthn server helpers.
 *
 * Per SRD §17.9 / §17.8: the vigil-apex Keycloak realm is FIDO2-only (no
 * passwords). For council vote signing, the user's YubiKey produces a
 * secp256k1-curve assertion (COSE alg -47); we extract the (r,s) signature
 * from the assertion and pair it with the recovery byte to construct a
 * Polygon-valid transaction signature (SRD §17.8.3).
 *
 * Per W-10: this is the FALLBACK path; the primary path is a small native
 * desktop helper using libykcs11. WebAuthn here remains documented for
 * accessibility-edge cases.
 */

export interface RpInfo {
  readonly rpName: string;
  readonly rpId: string; // domain
  readonly origin: readonly string[]; // 'https://vigilapex.cm'
}

export interface RegisteredCredential {
  readonly credentialId: string; // base64url
  readonly publicKey: Uint8Array; // COSE public key
  readonly counter: number;
  readonly transports?: readonly AuthenticatorTransportFuture[];
  readonly aaguid?: string;
}

type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

/* =============================================================================
 * Registration
 * ===========================================================================*/

export interface RegistrationChallengeOptions {
  readonly rp: RpInfo;
  readonly userId: string; // utf-8
  readonly userDisplayName: string;
  readonly excludeCredentialIds?: readonly string[];
  readonly aaguidAllowlist?: readonly string[];
}

export async function buildRegistrationChallenge(o: RegistrationChallengeOptions): Promise<{
  challenge: string;
  options: ReturnType<typeof generateRegistrationOptions> extends Promise<infer X> ? X : never;
}> {
  const opts = await generateRegistrationOptions({
    rpName: o.rp.rpName,
    rpID: o.rp.rpId,
    userName: o.userDisplayName,
    userID: new TextEncoder().encode(o.userId),
    attestationType: 'direct',
    authenticatorSelection: {
      requireResidentKey: false,
      userVerification: 'required',
      authenticatorAttachment: 'cross-platform',
    },
    supportedAlgorithmIDs: [-7, -8, -47, -257], // ES256, EdDSA, ES256K (secp256k1), RS256
    excludeCredentials: (o.excludeCredentialIds ?? []).map((id) => ({ id })),
  });
  return { challenge: opts.challenge, options: opts };
}

export interface VerifyRegistrationOptions {
  readonly response: RegistrationResponseJSON;
  readonly expectedChallenge: string;
  readonly rp: RpInfo;
  readonly aaguidAllowlist?: readonly string[];
}

export async function verifyRegistration(o: VerifyRegistrationOptions): Promise<RegisteredCredential> {
  const v = await verifyRegistrationResponse({
    response: o.response,
    expectedChallenge: o.expectedChallenge,
    expectedOrigin: [...o.rp.origin],
    expectedRPID: o.rp.rpId,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) {
    throw new Errors.FidoVerificationError('registration not verified');
  }

  const aaguid = v.registrationInfo.aaguid;
  if (o.aaguidAllowlist !== undefined && o.aaguidAllowlist.length > 0) {
    if (!o.aaguidAllowlist.includes(aaguid)) {
      throw new Errors.FidoVerificationError(`AAGUID ${aaguid} not in allowlist`);
    }
  }

  return {
    credentialId: v.registrationInfo.credential.id,
    publicKey: v.registrationInfo.credential.publicKey,
    counter: v.registrationInfo.credential.counter,
    aaguid,
  };
}

/* =============================================================================
 * Authentication
 * ===========================================================================*/

export async function buildAuthenticationChallenge(opts: {
  rp: RpInfo;
  allowCredentialIds?: readonly string[];
}): Promise<{
  challenge: string;
  options: ReturnType<typeof generateAuthenticationOptions> extends Promise<infer X> ? X : never;
}> {
  const r = await generateAuthenticationOptions({
    rpID: opts.rp.rpId,
    allowCredentials: (opts.allowCredentialIds ?? []).map((id) => ({ id })),
    userVerification: 'required',
  });
  return { challenge: r.challenge, options: r };
}

export interface VerifyAuthenticationOptions {
  readonly response: AuthenticationResponseJSON;
  readonly expectedChallenge: string;
  readonly rp: RpInfo;
  readonly credential: RegisteredCredential;
}

export async function verifyAuthentication(o: VerifyAuthenticationOptions): Promise<{
  verified: boolean;
  newCounter: number;
}> {
  const v = await verifyAuthenticationResponse({
    response: o.response,
    expectedChallenge: o.expectedChallenge,
    expectedOrigin: [...o.rp.origin],
    expectedRPID: o.rp.rpId,
    credential: {
      id: o.credential.credentialId,
      publicKey: o.credential.publicKey,
      counter: o.credential.counter,
    },
    requireUserVerification: true,
  });
  if (!v.verified) throw new Errors.FidoVerificationError('authentication not verified');
  return { verified: true, newCounter: v.authenticationInfo.newCounter };
}
