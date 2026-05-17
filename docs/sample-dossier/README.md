# Sample dossier — synthetic, for review purposes only

This directory contains a **synthetic, fully-fabricated** dossier illustrating
what VIGIL APEX produces and delivers to an institutional recipient (CONAC,
Cour des Comptes, MINFI, ANIF, CDC). The reviewer can read this to understand
the actual output shape, evidence-quoting style, citation structure, and
bilingual layout the system enforces.

**Everything below is invented.** No real entities, no real findings, no real
amounts. The IDs (`f-review-001`, `0xpillar-a`, etc.) match the synthetic
events the `scripts/review-demo.sh` seeder appends to the audit chain, so a
reviewer running the live demo sees the same identifiers in both places.

## Files

- [sample-dossier-fr.md](sample-dossier-fr.md) — synthetic dossier, French
  primary (rendered language for a Cameroon recipient).
- [sample-dossier-en.md](sample-dossier-en.md) — synthetic dossier, English
  translation auto-generated alongside (every dossier ships bilingual).
- [sample-manifest.json](sample-manifest.json) — the JSON manifest that
  worker-conac-sftp uploads alongside the PDFs (canonical-form fields per
  format-adapter, recipient-body-specific schema, signer fingerprint,
  pdf_sha256, audit-anchor reference).

## What's NOT here

- **The actual PDF.** Production rendering needs `soffice --headless --convert-to pdf`
  (LibreOffice) running against `packages/dossier/src/render.ts`'s DOCX output.
  See [apps/worker-dossier/src/index.ts](../../apps/worker-dossier/src/index.ts)
  for the production rendering path + the tier-58 audit closure that pins the
  size cap + timeout + stderr capture.
- **The GPG signature.** Production signatures are produced by
  `gpgDetachSign` ([packages/dossier/src/sign.ts](../../packages/dossier/src/sign.ts))
  against the YubiKey-resident `GPG_FINGERPRINT`. The DEV-UNSIGNED- fallback
  prefix protects against unsigned delivery in production
  (see [apps/worker-conac-sftp/src/dev-unsigned-guard.ts](../../apps/worker-conac-sftp/src/dev-unsigned-guard.ts)).
- **The Polygon anchor transaction.** Production anchors are submitted by
  worker-anchor via the YubiKey-backed Unix-domain-socket signer
  ([tools/vigil-polygon-signer](../../tools/vigil-polygon-signer)).

## How to verify the markdown matches the renderer

```bash
# Open the synthetic dossier in your terminal:
cat docs/sample-dossier/sample-dossier-fr.md | less

# Compare against the docx renderer's section ordering:
grep -nE "Paragraph\(.*heading.*HEADING_1" packages/dossier/src/render.ts
```

The section headings + bilingual phrasing here are extracted verbatim from
[packages/dossier/src/render.ts](../../packages/dossier/src/render.ts)'s
`tFr` / `tEn` translation tables (lines ~150-230). Any future refactor of
those tables should refresh this sample to match — the dossier renderer's
test suite at [packages/dossier/test/](../../packages/dossier/test/) is the
contract.
