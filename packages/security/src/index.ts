/**
 * @vigil/security — Vault, libsodium, FIDO2, mTLS.
 *
 * Hard rule: NO secret ever appears as a plain JS string outside of this
 * package. Workers receive opaque `Secret<T>` handles; consumers call
 * `expose(secret)` only at the moment a secret is needed by an external API.
 */
export * from './vault.js';
export * from './secrets.js';
export * from './sodium.js';
export * from './shamir.js';
export * from './fido.js';
export * from './mtls.js';
