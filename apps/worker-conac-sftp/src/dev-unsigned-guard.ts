/**
 * T8.3 of TODO.md sweep — extract the DEV-UNSIGNED- refusal predicate
 * into a focused module so tests can import it without triggering
 * src/index.ts's bottom-of-file main() (which calls process.exit(1)
 * on missing env vars / Vault / DB and unhandled-rejects in vitest).
 *
 * The contract this module defends:
 *
 *   `apps/worker-dossier/src/libreoffice.ts` computeDevUnsignedFingerprint
 *   emits `DEV-UNSIGNED-<gpgFingerprint>` when the operator opts in
 *   to the dev-fallback path AND the GPG sign fails. Such dossiers
 *   MUST NOT reach an institutional SFTP recipient. Two-tier defence:
 *   the dossier worker's devUnsignedAllowed() refuses the fallback in
 *   production; THIS worker (worker-conac-sftp) refuses to deliver if
 *   one ever slips through.
 *
 * The prefix string is the cross-worker contract — any drift between
 * the dossier-side emitter and this gate would silently re-open the
 * hole. Pinned in the test file.
 */

export const DEV_UNSIGNED_FINGERPRINT_PREFIX = 'DEV-UNSIGNED-';

export function isDevUnsignedFingerprint(fp: string | null | undefined): boolean {
  return typeof fp === 'string' && fp.startsWith(DEV_UNSIGNED_FINGERPRINT_PREFIX);
}
