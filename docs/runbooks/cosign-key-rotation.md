# Runbook — Cosign signing-key rotation

> Operational procedure for generating + rotating the cosign signing
> keypair used by VIGIL APEX to sign container images. Closes part of
> mode 9.9 (cosign sig not verified on every pull) — this runbook is
> the canonical procedure for the key half; verification runs
> automatically in CI + cluster via Phase 12a framework.
>
> **Audience:** the architect (key custody is YubiKey-backed; no other
> operator holds the private key).
>
> **Authority:** the architect alone runs this procedure. Witnesses
> required for the initial ceremony (per `docs/source/HSK-v1.md`
> §"Witnessed key ceremonies").

---

## Why a calendar cadence

The cosign signing key has the same blast radius as the GPG release-
signing subkey: compromise of the key lets an adversary publish a
"valid-looking" signed image. The mitigations are:

1. **YubiKey-backed key custody** — the private key never exists in
   plaintext at rest; it's PIV-stored on a dedicated YubiKey 5C
   (slot 9c, retired-key-signing).
2. **Annual rotation** — fresh key every year, with a 90-day
   overlap window during which both the old and the new key are
   trusted by `cosign verify`. After the overlap, the old key is
   archived (per HSK §"Retired key archival") and the verify
   policy is updated to trust only the new key.
3. **Public-key transparency** — every issued public key is
   anchored to the audit chain (Polygon + Fabric) at the moment of
   issue. The audit-chain entry records `kind=cosign_key_issued`
   with the SHA-256 of the public key + the YubiKey serial number.

---

## Cadence

**Annual: first Monday of January.** The architect schedules a 4-hour
ceremony block with at least one witness. Ceremony output:

- New cosign keypair (private on YubiKey, public exported).
- 90-day overlap window starts (old key still trusted for verify).
- Audit-chain entry recording the issue.
- Updates pushed to: GitHub Actions secret (`COSIGN_PRIVATE_KEY` +
  `COSIGN_PASSWORD`), Vault (`vigil/cosign/private` + `vigil/cosign/public`),
  Helm chart values (`cosignVerify.publicKey`).

Emergency rotation:

- **Compromise alert** (lost YubiKey, stolen recovery seed, etc.):
  rotate within 24 hours; revoke the old key in Rekor; mark all
  signatures made after the suspected compromise date as
  not-trusted.
- **Maintainer rotation** (architect-of-record change): rotate at
  the handover. The new architect generates the new key; the old
  architect signs the public-key transition message.

---

## Initial key generation (one-time)

### Pre-ceremony checks

```bash
# Verify cosign CLI is installed + pinned.
cosign version
# Expect: GitVersion: v2.4.1 (or whatever VIGIL pins this cycle)

# Verify the YubiKey is plugged in + responds to PIV.
yubico-piv-tool -a status
```

### Generate the keypair

```bash
# Set a strong password. The password unlocks the encrypted private
# key when cosign reads it from the YubiKey-stored slot.
read -s -p "Cosign password: " COSIGN_PASSWORD; export COSIGN_PASSWORD

# Generate the keypair. The private key is written to ./cosign.key
# (encrypted with COSIGN_PASSWORD) and the public key to ./cosign.pub.
cosign generate-key-pair

# Inspect the public key.
cat cosign.pub
```

### Move the private key onto the YubiKey

```bash
# Import the private key into PIV slot 9c (retired-key-signing).
yubico-piv-tool -a import-key -s 9c -i cosign.key
# yubico-piv-tool prompts for the YubiKey management key + the
# private key's COSIGN_PASSWORD.

# Generate a self-signed cert for slot 9c (cosign needs it for the
# PKCS#11 binding).
yubico-piv-tool -a selfsign -s 9c -S "/CN=VIGIL APEX cosign signing/" \
  -i cosign.pub -o cosign.crt
yubico-piv-tool -a import-certificate -s 9c -i cosign.crt
```

### Wipe local copies

```bash
# The private key now lives ONLY on the YubiKey. Securely wipe local
# copies; the public key + cert stay (architect needs them for
# distribution).
shred -u cosign.key
# Keep cosign.pub and cosign.crt for distribution.
```

### Anchor the public key to the audit chain

```bash
# Compute the public-key fingerprint.
PUBKEY_SHA=$(sha256sum cosign.pub | awk '{print $1}')
echo "Public key SHA-256: ${PUBKEY_SHA}"

# Write the audit-chain entry. The kind=cosign_key_issued entry
# records: pubkey SHA-256, YubiKey serial, ceremony witnesses,
# expiry (= today + 365 days).
psql -U vigil_admin -c "INSERT INTO audit.event
  (kind, payload, actor)
VALUES (
  'cosign_key_issued',
  jsonb_build_object(
    'pubkey_sha256', '${PUBKEY_SHA}',
    'yubikey_serial', '$(yubico-piv-tool -a status | grep Serial | awk '{print $2}')',
    'expires_at',     (now() + interval '365 days')::text,
    'witnesses',      ARRAY['witness1@example.org', 'witness2@example.org']
  ),
  'architect@vigilapex.cm'
);"
```

The next anchor sweep (worker-anchor) commits this entry to Polygon

- Fabric.

### Distribute the public key

1. **GitHub Actions secret** (for `security.yml` `cosign-sign-images`
   job):
   - In GitHub repo settings → Secrets → New repository secret:
     - `COSIGN_PRIVATE_KEY` = contents of `cosign.key` BEFORE the
       wipe (re-export from YubiKey via `yubico-piv-tool -a
read-object -s 9c`, BASE64-encoded so it fits in a secret
       envelope).
     - `COSIGN_PASSWORD` = the password set during generation.

2. **Vault**:

   ```bash
   vault kv put vigil/cosign \
     public_key_pem=@cosign.pub \
     public_key_sha256=${PUBKEY_SHA} \
     issued_at=$(date -Iseconds) \
     expires_at=$(date -d '+365 days' -Iseconds) \
     yubikey_serial=$(yubico-piv-tool -a status | grep Serial | awk '{print $2}')
   ```

3. **Helm chart values** (for the Kyverno ClusterPolicy):

   ```bash
   helm upgrade vigil-apex ./infra/k8s/charts/vigil-apex \
     --reuse-values \
     --set cosignVerify.enabled=true \
     --set-file cosignVerify.publicKey=cosign.pub
   ```

4. **Compose stack** (for the `cosign-verifier` overlay):

   ```bash
   cp cosign.pub /srv/vigil/cosign/cosign.pub
   chmod 0444 /srv/vigil/cosign/cosign.pub
   chown root:root /srv/vigil/cosign/cosign.pub
   ```

---

## Annual rotation

Same procedure as initial generation, except:

1. **Old key remains in slot 9c.** Generate the new key in PIV slot
   9d (digital-signature) — both slots are usable; the active slot is
   tracked in Vault metadata.

2. **90-day overlap window.** The CI signing job + the cluster verify
   policy + the compose verifier all temporarily trust BOTH the old
   and the new public key. Update `cosignVerify.publicKey` to a
   list:

   ```yaml
   cosignVerify:
     publicKey: |
       -----BEGIN PUBLIC KEY-----
       <OLD KEY>
       -----END PUBLIC KEY-----
       -----BEGIN PUBLIC KEY-----
       <NEW KEY>
       -----END PUBLIC KEY-----
   ```

   The Kyverno ClusterPolicy iterates the publicKeys list and accepts
   any one match.

3. **Cutover at day 90.** Remove the old key from the values.
   Re-sign any images still in use with the new key (older releases
   may need a re-signature ceremony if they're still hot in the
   registry).

4. **Archive the old key.** Per HSK §"Retired key archival": the
   old YubiKey is moved to the offsite safe; the slot 9c contents
   stay readable for forensic verification but are no longer trusted
   for new signatures.

---

## Emergency rotation (compromise alert)

**SLA: 24 hours from detection to new key active.**

1. **Hour 0**: Architect declares compromise. Witnesses notified.
2. **Hour 0–1**: New key generated on a fresh YubiKey (slot 9c on
   the new device). Old key marked compromised in audit chain:

   ```sql
   INSERT INTO audit.event (kind, payload, actor) VALUES (
     'cosign_key_compromised',
     jsonb_build_object(
       'old_pubkey_sha256', '<OLD>',
       'suspected_compromise_at', '<TIMESTAMP>',
       'reason', '<lost-yubikey | stolen-recovery-seed | other>'
     ),
     'architect@vigilapex.cm'
   );
   ```

3. **Hour 1–4**: New public key distributed (steps 1–4 of initial
   generation). Old key removed from `cosignVerify.publicKey`
   immediately — no overlap window for compromise.
4. **Hour 4–24**: Re-sign every image in the registry with the new
   key. Images that can't be re-signed (orphaned tags) are tombstoned
   in the audit chain.
5. **Within 7 days**: Public statement of compromise + new public
   key fingerprint posted to the institutional channels (per HSK
   §"Public disclosure of key events").

---

## Verification

After any key generation or rotation, the following must pass:

```bash
# 1. The new public key matches what's in Vault.
vault kv get -field=public_key_pem vigil/cosign > /tmp/vault-pub.pem
diff cosign.pub /tmp/vault-pub.pem || echo "DRIFT"

# 2. The new public key matches what GitHub Actions has (via Snyk's
#    secret-metadata API, or by triggering a test CI run).

# 3. The Kyverno ClusterPolicy reflects the new key.
kubectl get clusterpolicy vigil-apex-cosign-verify-images \
  -o jsonpath='{.spec.rules[0].verifyImages[0].attestors[0].entries[0].keys.publicKeys}' \
  | diff - cosign.pub || echo "DRIFT"

# 4. The compose overlay reads the new key from disk.
docker compose -f infra/docker/docker-compose.yaml \
  -f infra/docker/compose.cosign-verify.yaml \
  config cosign-verifier | grep -A5 volumes
```

All four must show no drift.

---

## Related

- `docs/runbooks/cosign-rollout.md` — end-to-end activation of the
  cosign framework after this runbook's initial key generation lands.
- `docs/source/HSK-v1.md` — YubiKey Estate Manual; the canonical doc
  for any key custody decision.
- `docs/runbooks/secret-rotation.md` — sister runbook for the other
  rotations (Redis password, Postgres password, Turnstile, TLS).
- `docs/decisions/decision-020-dl380-ai-security-tier.md` — Phase-2
  hardware procurement; the cosign verifier runs on the same nodes.
- `infra/k8s/charts/vigil-apex/templates/kyverno-cosign-policy.yaml`
  — the cluster-side enforcement.
- `infra/docker/compose.cosign-verify.yaml` — the compose-side
  enforcement.
- `.github/workflows/security.yml` `cosign-sign-images` job — the
  build-side signing.
