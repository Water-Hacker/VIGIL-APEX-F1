#!/usr/bin/env bash
# Block-E E.14 — encrypted-at-rest archive smoke test.
#
# Architect E.14 close-halt acceptance: "show me ... the restore-actually-
# decrypts test before E.15 opens." This is the binding test for the
# encrypt → store → decrypt round-trip the nightly backup contract relies on.
#
# What this proves:
#   1. gpg --encrypt --recipient <fingerprint> produces a .gpg blob from a
#      plaintext input, leaving the plaintext untouched on disk.
#   2. gpg --decrypt against the same blob with the matching private key
#      recovers the plaintext byte-for-byte.
#   3. The encrypted blob does NOT contain any plaintext substring (entropy
#      check — not a cryptographic proof, but catches "encryption
#      accidentally produced a copy" misconfigurations).
#   4. A detached signature (sig over plaintext) round-trips: sign before
#      encrypt → decrypt → re-verify .sig against decrypted plaintext.
#
# Test isolation: a throwaway GPG keyring is created in a temp directory.
# The test does NOT touch the architect's real keyring, never invokes the
# real GPG_ENCRYPT_RECIPIENT, and removes itself on completion.
#
# Run from the repo root:
#   bash scripts/test-encrypt-roundtrip.sh
#
# Exit codes:
#   0 — all 4 properties verified
#   1 — any property failed (the failing assertion is named in the output)
#   2 — environment problem (gpg not installed, temp dir not writable)
set -euo pipefail

if ! command -v gpg >/dev/null 2>&1; then
  echo "FATAL: gpg not installed; cannot run encrypt-roundtrip test"
  exit 2
fi

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP}"
}
trap cleanup EXIT

export GNUPGHOME="${TMP}/gnupg"
mkdir -p "${GNUPGHOME}"
chmod 700 "${GNUPGHOME}"

# Generate a throwaway keypair. --quick-generate-key is the modern
# unattended-keygen API; passphrase-less so we can decrypt without a
# pinentry hop in CI.
echo "[*] generating throwaway test keypair"
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key 'vigil-encrypt-roundtrip-test@example.invalid' \
    rsa2048 sign 1d 2>/dev/null

TEST_KEY_FP="$(gpg --list-keys --with-colons vigil-encrypt-roundtrip-test@example.invalid \
                | awk -F: '/^fpr:/{print $10; exit}')"

if [ -z "${TEST_KEY_FP}" ]; then
  echo "FAIL: could not extract test key fingerprint"
  exit 1
fi
echo "[*] test key fingerprint: ${TEST_KEY_FP}"

# Add an encrypt subkey — mirrors the architect's HSK-v1 estate
# (master sign key + encrypt subkey).
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-add-key "${TEST_KEY_FP}" rsa2048 encrypt 1d 2>/dev/null

# 1. Plaintext fixture. Includes a known marker we'll grep for in the
#    .gpg blob to prove encryption is doing something.
PLAINTEXT="${TMP}/test-archive.txt"
MARKER="vigil-apex-plaintext-marker-$(date +%s%N)"
cat > "${PLAINTEXT}" <<EOF
Block-E E.14 encrypt-roundtrip test fixture.
${MARKER}
audit-chain row: id=test-1 seq=1 action=test
EOF

# 2. Sign first, then encrypt — mirrors 10-vigil-backup.sh order
#    (audit-chain.csv.sig over plaintext is produced BEFORE encrypt_at_rest).
echo "[*] sign plaintext"
gpg --batch --yes --pinentry-mode loopback --passphrase '' \
    --local-user "${TEST_KEY_FP}" \
    --output "${PLAINTEXT}.sig" \
    --detach-sign "${PLAINTEXT}"

echo "[*] encrypt plaintext → .gpg"
gpg --batch --yes --trust-model always \
    --recipient "${TEST_KEY_FP}" \
    --output "${PLAINTEXT}.gpg" \
    --encrypt "${PLAINTEXT}"

# 3. Properties.

# Property 1: encrypted blob exists and is non-empty.
if [ ! -s "${PLAINTEXT}.gpg" ]; then
  echo "FAIL: ${PLAINTEXT}.gpg is empty"
  exit 1
fi
echo "[ok] property 1 — encrypted blob produced ($(stat -c%s "${PLAINTEXT}.gpg") bytes)"

# Property 2: encrypted blob does NOT contain the marker (sanity entropy check).
if grep -aF "${MARKER}" "${PLAINTEXT}.gpg" >/dev/null; then
  echo "FAIL: marker '${MARKER}' found in encrypted blob — encryption broken"
  exit 1
fi
echo "[ok] property 2 — encrypted blob does not leak plaintext marker"

# Property 3: decrypt round-trip recovers plaintext byte-for-byte.
DECRYPTED="${TMP}/test-archive.decrypted.txt"
gpg --batch --yes --pinentry-mode loopback --passphrase '' \
    --output "${DECRYPTED}" \
    --decrypt "${PLAINTEXT}.gpg"

if ! cmp -s "${PLAINTEXT}" "${DECRYPTED}"; then
  echo "FAIL: decrypted output differs from plaintext"
  diff "${PLAINTEXT}" "${DECRYPTED}" | head -20
  exit 1
fi
echo "[ok] property 3 — decrypt round-trip recovers plaintext byte-for-byte"

# Property 4: detached signature still verifies against decrypted plaintext.
if ! gpg --batch --verify "${PLAINTEXT}.sig" "${DECRYPTED}" 2>/dev/null; then
  echo "FAIL: detached signature does not verify against decrypted plaintext"
  exit 1
fi
echo "[ok] property 4 — detached signature verifies against decrypted plaintext"

echo
echo "[PASS] encrypt-roundtrip: 4/4 properties verified"
exit 0
