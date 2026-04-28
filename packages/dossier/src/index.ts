/**
 * @vigil/dossier — deterministic bilingual PDF render.
 *
 * Pipeline (SRD §24.9):
 *   build .docx (deterministic) → LibreOffice headless → PDF → sign with GPG
 *   → SHA-256 → IPFS pin
 *
 * Reproducibility: identical input ⇒ byte-identical PDF (SRD §24.10 acceptance test).
 */
export * from './render.js';
export * from './qr.js';
export * from './sign.js';
export * from './types.js';
