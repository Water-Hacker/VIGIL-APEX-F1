#!/bin/sh
# lo-repro-test — deterministic LibreOffice render check (Phase F12).
#
# Usage: lo-repro-test <input.docx> <expected_sha256>
# Exits 0 on match, 1 on mismatch. Used in CI nightly soak + on every
# image build that touches the Worker.Dockerfile or the dossier template.
#
# SOURCE_DATE_EPOCH=1735689600 (2025-01-01 UTC) keeps the embedded
# document timestamps stable; --convert-to flags pin every other
# rendering option that affects byte output.
set -eu

IN="${1:?input docx required}"
EXPECTED="${2:?expected sha256 required}"
OUTDIR="$(mktemp -d)"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1735689600}"

soffice --headless \
        --convert-to "pdf:writer_pdf_Export:UseTaggedPDF=false;ExportFormFields=false;ReduceImageResolution=false;EmbedStandardFonts=true" \
        --outdir "${OUTDIR}" "${IN}" >/dev/null

ACTUAL="$(sha256sum "${OUTDIR}"/*.pdf | awk '{print $1}')"
if [ "${ACTUAL}" != "${EXPECTED}" ]; then
  echo "[FAIL] LibreOffice render not reproducible:"
  echo "  expected: ${EXPECTED}"
  echo "  actual:   ${ACTUAL}"
  echo "  LibreOffice: $(soffice --version 2>/dev/null | head -1)"
  exit 1
fi
echo "[ok] LibreOffice render reproducible (${ACTUAL})"
