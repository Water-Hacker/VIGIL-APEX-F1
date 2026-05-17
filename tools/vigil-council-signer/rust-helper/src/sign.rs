//! Pure ECDSA-P256 helpers used by the council-vote signer.
//!
//! These functions DO NOT touch hardware; they are PKCS#11-output →
//! WebAuthn-shaped signature mathematics. Hardware-dependent code
//! lives in `main.rs`. Splitting like this lets us unit-test the
//! math on any host without a YubiKey present.
//!
//! W-10 context: the council-vote channel was originally specified
//! to use WebAuthn assertions over a secp256k1 key (SRD §17.8.3) but
//! browser support for secp256k1 is fragile (only Chrome on
//! YubiKey 5+ FW 5.4+; Firefox / Safari variable). The native
//! helper instead drives a P-256 PIV slot via PKCS#11 — fully
//! supported by every YubiKey 4+ shipped in the last decade, and
//! the curve every WebAuthn implementation accepts (COSE alg `-7`).
//! The resulting (r, s) signature is identical in shape to what a
//! WebAuthn authenticator would produce; the dashboard verifier
//! does not need to know which path was used.

use anyhow::{anyhow, bail, Context, Result};

/// NIST P-256 curve order (n). Used for low-S normalisation per
/// RFC 6979 §2.4 — many ECDSA verifiers (including OpenSSL ≥3
/// strict mode and some WebAuthn libraries) reject signatures with
/// s > n/2. PKCS#11's C_Sign returns a deterministic result that
/// may or may not be low-S depending on the token vendor; we
/// normalise unconditionally.
const P256_N: [u8; 32] = [
    0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, //
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, //
    0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, //
    0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
];

/// N / 2 — threshold for low-S normalisation.
const P256_N_HALF: [u8; 32] = [
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, //
    0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, //
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, //
    0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
];

/// A 32-byte big-endian scalar (r or s).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scalar32(pub [u8; 32]);

impl Scalar32 {
    pub fn from_slice(b: &[u8]) -> Result<Self> {
        if b.len() > 32 {
            bail!("scalar too large: {} bytes", b.len());
        }
        let mut out = [0u8; 32];
        // Left-pad with zeros to fixed 32 bytes (DER may emit shorter).
        out[32 - b.len()..].copy_from_slice(b);
        Ok(Scalar32(out))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Compare two 32-byte big-endian unsigned scalars.
fn cmp_scalar(a: &[u8; 32], b: &[u8; 32]) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Subtract `b` from `a` in 32-byte big-endian, assuming `a >= b`.
fn sub_scalar(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow: i32 = 0;
    for i in (0..32).rev() {
        let av = a[i] as i32;
        let bv = b[i] as i32;
        let mut d = av - bv - borrow;
        if d < 0 {
            d += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out[i] = d as u8;
    }
    debug_assert_eq!(borrow, 0, "sub_scalar called with a < b");
    out
}

/// Decode a DER-encoded ECDSA signature into (r, s). PKCS#11
/// returns signatures in this format for CKM_ECDSA. We also accept
/// compact 64-byte (r||s) for parity with the polygon-signer helper.
pub fn decode_der_or_compact(sig: &[u8]) -> Result<(Scalar32, Scalar32)> {
    if sig.len() == 64 {
        let r = Scalar32::from_slice(&sig[0..32])?;
        let s = Scalar32::from_slice(&sig[32..64])?;
        return Ok((r, s));
    }

    // DER: 0x30 len 0x02 rlen r... 0x02 slen s...
    let mut idx = 0usize;
    if sig.get(idx).copied() != Some(0x30) {
        bail!("not DER: expected 0x30 SEQUENCE, got {:?}", sig.first());
    }
    idx += 1;
    if idx >= sig.len() {
        bail!("truncated DER (length byte)");
    }
    let _seq_len = sig[idx] as usize;
    idx += 1;

    if sig.get(idx).copied() != Some(0x02) {
        bail!("expected INTEGER tag for r, got {:?}", sig.get(idx));
    }
    idx += 1;
    let r_len = *sig.get(idx).context("truncated DER (r len)")? as usize;
    idx += 1;
    let r_end = idx + r_len;
    if r_end > sig.len() {
        bail!("truncated DER (r body)");
    }
    let r_bytes = &sig[idx..r_end];
    idx = r_end;

    if sig.get(idx).copied() != Some(0x02) {
        bail!("expected INTEGER tag for s, got {:?}", sig.get(idx));
    }
    idx += 1;
    let s_len = *sig.get(idx).context("truncated DER (s len)")? as usize;
    idx += 1;
    let s_end = idx + s_len;
    if s_end > sig.len() {
        bail!("truncated DER (s body)");
    }
    let s_bytes = &sig[idx..s_end];

    // DER INTEGER may have a leading 0x00 to indicate positive when
    // the high bit is set; strip it.
    let r_bytes = strip_leading_zero(r_bytes);
    let s_bytes = strip_leading_zero(s_bytes);
    if r_bytes.len() > 32 || s_bytes.len() > 32 {
        bail!(
            "DER scalar oversized after zero-strip: r={} s={}",
            r_bytes.len(),
            s_bytes.len()
        );
    }
    let r = Scalar32::from_slice(r_bytes)?;
    let s = Scalar32::from_slice(s_bytes)?;
    Ok((r, s))
}

fn strip_leading_zero(b: &[u8]) -> &[u8] {
    if b.len() > 1 && b[0] == 0x00 && (b[1] & 0x80) != 0 {
        &b[1..]
    } else {
        b
    }
}

/// Replace s with n - s if s > n / 2 (low-S normalisation).
/// Returns the normalised scalar. Idempotent.
pub fn low_s_normalise(s: Scalar32) -> Scalar32 {
    if cmp_scalar(&s.0, &P256_N_HALF) == std::cmp::Ordering::Greater {
        Scalar32(sub_scalar(&P256_N, &s.0))
    } else {
        s
    }
}

/// Re-encode (r, s) as a 64-byte compact signature. The dashboard's
/// verifier accepts both DER and compact, but compact is what
/// WebAuthn's authenticator-data emits, so we hand back compact for
/// downstream parity.
pub fn compact_signature(r: &Scalar32, s: &Scalar32) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[0..32].copy_from_slice(r.as_bytes());
    out[32..64].copy_from_slice(s.as_bytes());
    out
}

/// Decode an X.509 SubjectPublicKeyInfo for an EC P-256 key into
/// the uncompressed point (65 bytes: 0x04 || X || Y). Used to
/// surface the council member's public key to the enrolment
/// ceremony so the dashboard can store it in their member record.
///
/// CKA_EC_POINT on a YubiKey PIV slot returns either the raw
/// uncompressed point (0x04 || X || Y, 65 bytes) OR a DER OCTET
/// STRING wrapping it (`0x04 0x41 0x04 ...`, 67 bytes). Accept both.
pub fn normalise_ec_point(b: &[u8]) -> Result<[u8; 65]> {
    if b.len() == 65 && b[0] == 0x04 {
        let mut out = [0u8; 65];
        out.copy_from_slice(b);
        return Ok(out);
    }
    if b.len() == 67 && b[0] == 0x04 && b[1] == 0x41 && b[2] == 0x04 {
        let mut out = [0u8; 65];
        out.copy_from_slice(&b[2..]);
        return Ok(out);
    }
    bail!(
        "expected uncompressed P-256 point (65 bytes, 0x04-prefix) \
         or DER OCTET STRING wrapping it (67 bytes); got {} bytes",
        b.len()
    );
}

/// Verify a (r, s) signature against an uncompressed public-key
/// point and the message hash. Returns Ok(()) on valid signature.
/// Used as a self-check after C_Sign — confirms the token did
/// the math we asked for, not a fault-injection attack.
pub fn verify_signature(
    public_key_uncompressed: &[u8; 65],
    msg_hash: &[u8; 32],
    r: &Scalar32,
    s: &Scalar32,
) -> Result<()> {
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    use p256::EncodedPoint;

    let encoded = EncodedPoint::from_bytes(public_key_uncompressed)
        .map_err(|e| anyhow!("invalid P-256 point: {e}"))?;
    let vk = VerifyingKey::from_encoded_point(&encoded)
        .map_err(|e| anyhow!("invalid P-256 verifying key: {e}"))?;
    let sig_bytes = compact_signature(r, s);
    let sig =
        Signature::try_from(sig_bytes.as_slice()).map_err(|e| anyhow!("invalid signature: {e}"))?;
    vk.verify(msg_hash, &sig)
        .map_err(|e| anyhow!("signature verification failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};
    use proptest::prelude::*;

    fn det_signing_key() -> SigningKey {
        // Deterministic test key — NOT a secret; this whole file is
        // public. The bytes are 1..=32 to make failures grep-able.
        let bytes: [u8; 32] = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32,
        ];
        SigningKey::from_bytes(&bytes.into()).unwrap()
    }

    #[test]
    fn decode_compact_round_trip() {
        let r: [u8; 32] = [0xaa; 32];
        let s: [u8; 32] = [0xbb; 32];
        let mut sig = [0u8; 64];
        sig[0..32].copy_from_slice(&r);
        sig[32..64].copy_from_slice(&s);
        let (r2, s2) = decode_der_or_compact(&sig).unwrap();
        assert_eq!(r2.as_bytes(), &r);
        assert_eq!(s2.as_bytes(), &s);
    }

    #[test]
    fn decode_der_minimal() {
        // Minimal DER: 30 06 02 01 01 02 01 01  => r=1, s=1
        let der = [0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01];
        let (r, s) = decode_der_or_compact(&der).unwrap();
        let mut want = [0u8; 32];
        want[31] = 1;
        assert_eq!(r.as_bytes(), &want);
        assert_eq!(s.as_bytes(), &want);
    }

    #[test]
    fn decode_der_with_leading_zero_for_positive_int() {
        // 30 08 02 02 00 80 02 01 01  => r=0x80, s=1
        // (the leading 0x00 disambiguates a high-bit-set positive
        // integer from a negative number in ASN.1; we strip it).
        let der = [0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x01, 0x01];
        let (r, _s) = decode_der_or_compact(&der).unwrap();
        let mut want = [0u8; 32];
        want[31] = 0x80;
        assert_eq!(r.as_bytes(), &want);
    }

    #[test]
    fn low_s_normalise_is_idempotent_below_half_n() {
        let s = Scalar32([0x01; 32]);
        let n1 = low_s_normalise(s);
        let n2 = low_s_normalise(n1);
        assert_eq!(n1, s);
        assert_eq!(n2, s);
    }

    #[test]
    fn low_s_normalise_flips_above_half_n() {
        // s = N - 1 is just below N; clearly above N/2.
        let mut s_bytes = P256_N;
        s_bytes[31] -= 1;
        let s = Scalar32(s_bytes);
        let n = low_s_normalise(s);
        // n - 1 normalised should be 1 (since N - (N-1) = 1).
        let mut want = [0u8; 32];
        want[31] = 1;
        assert_eq!(n.as_bytes(), &want);
    }

    #[test]
    fn normalise_ec_point_raw_uncompressed() {
        let mut p = [0u8; 65];
        p[0] = 0x04;
        for i in 1..65 {
            p[i] = i as u8;
        }
        let n = normalise_ec_point(&p).unwrap();
        assert_eq!(n[0], 0x04);
        assert_eq!(n[1], 1);
    }

    #[test]
    fn normalise_ec_point_der_wrapped() {
        let mut p = [0u8; 67];
        p[0] = 0x04; // OCTET STRING tag
        p[1] = 0x41; // length = 65
        p[2] = 0x04; // uncompressed prefix
        for i in 3..67 {
            p[i] = (i - 2) as u8;
        }
        let n = normalise_ec_point(&p).unwrap();
        assert_eq!(n[0], 0x04);
        assert_eq!(n[1], 1);
    }

    #[test]
    fn normalise_ec_point_rejects_garbage() {
        let p = [0u8; 32];
        assert!(normalise_ec_point(&p).is_err());
    }

    #[test]
    fn verify_signature_round_trip_with_real_p256_key() {
        let sk = det_signing_key();
        let vk = sk.verifying_key();
        let pubkey_bytes = vk.to_encoded_point(false);
        assert_eq!(pubkey_bytes.as_bytes().len(), 65);
        let mut pubkey: [u8; 65] = [0u8; 65];
        pubkey.copy_from_slice(pubkey_bytes.as_bytes());

        let msg_hash: [u8; 32] = [0x42; 32];
        let sig: p256::ecdsa::Signature = sk.sign(&msg_hash);
        let der = sig.to_der();
        let der_bytes = der.as_bytes();
        let (r, s) = decode_der_or_compact(der_bytes).unwrap();
        let s_norm = low_s_normalise(s);
        verify_signature(&pubkey, &msg_hash, &r, &s_norm).expect("self-verify must succeed");
    }

    proptest! {
        #[test]
        fn decode_compact_any_64_bytes(r: [u8; 32], s: [u8; 32]) {
            let mut sig = [0u8; 64];
            sig[0..32].copy_from_slice(&r);
            sig[32..64].copy_from_slice(&s);
            let (r2, s2) = decode_der_or_compact(&sig).unwrap();
            prop_assert_eq!(r2.as_bytes(), &r);
            prop_assert_eq!(s2.as_bytes(), &s);
        }
    }
}
