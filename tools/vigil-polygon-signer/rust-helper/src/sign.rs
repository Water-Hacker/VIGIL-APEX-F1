//! Pure secp256k1 helpers used by the YubiKey signer.
//!
//! These functions DO NOT touch hardware; they are PKCS#11-output ->
//! Ethereum-signature mathematics. Hardware-dependent code lives in
//! `main.rs`. Splitting like this lets us unit-test the math on any
//! host without a YubiKey present.

use anyhow::{anyhow, bail, Context, Result};
use secp256k1::{
    ecdsa::{RecoverableSignature, RecoveryId, Signature},
    Message, PublicKey, Secp256k1, SecretKey,
};

/// secp256k1 curve order (n). Defined by the SEC2 standard.
/// Used for low-S normalisation: if s > N/2, replace s with N - s.
/// Ethereum rejects high-S signatures (EIP-2).
const SECP256K1_N: [u8; 32] = [
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, //
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE, //
    0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B, //
    0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x41,
];

/// N / 2 (half the curve order). Threshold for low-S normalisation.
const SECP256K1_N_HALF: [u8; 32] = [
    0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, //
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, //
    0x5D, 0x57, 0x6E, 0x73, 0x57, 0xA4, 0x50, 0x1D, //
    0xDF, 0xE9, 0x2F, 0x46, 0x68, 0x1B, 0x20, 0xA0,
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

/// Compare two 32-byte big-endian unsigned scalars. Returns
/// std::cmp::Ordering. Branchless-ish to keep timing data flat,
/// though we don't rely on this for security (s is public).
fn cmp_scalar(a: &[u8; 32], b: &[u8; 32]) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Subtract `b` from `a` in 32-byte big-endian, assuming `a >= b`.
/// Used for `n - s` when normalising. Panics if `a < b`.
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

/// Decode a DER-encoded ECDSA signature into (r, s). PKCS#11 returns
/// signatures in this format for CKM_ECDSA. We accept both compact
/// 64-byte (r||s) and DER.
pub fn decode_der_or_compact(sig: &[u8]) -> Result<(Scalar32, Scalar32)> {
    if sig.len() == 64 {
        // Compact: r||s, each 32 bytes.
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
    let seq_len = sig[idx] as usize;
    idx += 1;
    if seq_len + idx != sig.len() {
        bail!(
            "DER length mismatch: declared {}, actual {}",
            seq_len + idx,
            sig.len()
        );
    }

    // r
    if sig.get(idx).copied() != Some(0x02) {
        bail!("DER: expected INTEGER tag for r");
    }
    idx += 1;
    let r_len = *sig.get(idx).context("truncated DER (r len)")? as usize;
    idx += 1;
    let r_end = idx + r_len;
    if r_end > sig.len() {
        bail!("DER: r overruns buffer");
    }
    let r_bytes = strip_leading_zero(&sig[idx..r_end])?;
    let r = Scalar32::from_slice(r_bytes)?;
    idx = r_end;

    // s
    if sig.get(idx).copied() != Some(0x02) {
        bail!("DER: expected INTEGER tag for s");
    }
    idx += 1;
    let s_len = *sig.get(idx).context("truncated DER (s len)")? as usize;
    idx += 1;
    let s_end = idx + s_len;
    if s_end > sig.len() {
        bail!("DER: s overruns buffer");
    }
    let s_bytes = strip_leading_zero(&sig[idx..s_end])?;
    let s = Scalar32::from_slice(s_bytes)?;

    Ok((r, s))
}

/// DER INTEGER may have a leading 0x00 if the high bit of the next
/// byte is set (so the value reads as positive). Strip it.
fn strip_leading_zero(b: &[u8]) -> Result<&[u8]> {
    if b.is_empty() {
        bail!("DER: empty INTEGER");
    }
    if b.len() > 1 && b[0] == 0x00 && (b[1] & 0x80) != 0 {
        Ok(&b[1..])
    } else {
        Ok(b)
    }
}

/// Low-S normalise — if s > n/2, replace with n - s. Required by EIP-2.
pub fn low_s_normalise(s: Scalar32) -> Scalar32 {
    match cmp_scalar(&s.0, &SECP256K1_N_HALF) {
        std::cmp::Ordering::Greater => Scalar32(sub_scalar(&SECP256K1_N, &s.0)),
        _ => s,
    }
}

/// Given (r, s) and the message hash and the EXPECTED signer address
/// (derived from the YubiKey public key), recover the v byte (0 or 1
/// in raw form, 27 or 28 with the legacy offset). Returns the v in
/// recoverable-signature form (0 or 1) on success.
///
/// We try v=0 and v=1 against the message+signature pair. Whichever
/// recovers a pubkey whose keccak256 last-20 bytes match the expected
/// address is the right v. If neither matches, the signature is
/// invalid against this key — we error out.
pub fn recover_v(
    msg_hash: &[u8; 32],
    r: &Scalar32,
    s: &Scalar32,
    expected_address: &[u8; 20],
) -> Result<u8> {
    let secp = Secp256k1::verification_only();
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&r.0);
    combined[32..].copy_from_slice(&s.0);

    let msg = Message::from_digest_slice(msg_hash)
        .context("msg hash must be exactly 32 bytes")?;

    for v in 0u8..=1u8 {
        let recid = match RecoveryId::from_i32(v as i32) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let sig = match RecoverableSignature::from_compact(&combined, recid) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let pubkey = match secp.recover_ecdsa(&msg, &sig) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let addr = pubkey_to_eth_address(&pubkey);
        if &addr == expected_address {
            return Ok(v);
        }
    }
    Err(anyhow!(
        "v recovery failed: neither v=0 nor v=1 produced the expected signer address"
    ))
}

/// Map a secp256k1 public key to its Ethereum address.
/// addr = keccak256(uncompressed_pubkey[1..]) -- last 20 bytes
pub fn pubkey_to_eth_address(pk: &PublicKey) -> [u8; 20] {
    let uncompressed = pk.serialize_uncompressed(); // 65 bytes: 0x04 || x || y
    debug_assert_eq!(uncompressed.len(), 65);
    let hash = keccak256(&uncompressed[1..]);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..32]);
    out
}

/// Map a 65-byte uncompressed EC point (as PKCS#11 returns) to an
/// Ethereum address. Handles the optional leading DER OCTET STRING tag
/// that some PKCS#11 modules add.
pub fn ec_point_to_eth_address(ec_point: &[u8]) -> Result<[u8; 20]> {
    let raw: &[u8] = if ec_point.len() >= 2 && ec_point[0] == 0x04 && ec_point[1] == 0x41 {
        // DER OCTET STRING wrap: 0x04 len(0x41=65) ...
        &ec_point[2..]
    } else if ec_point.len() == 67 && ec_point[0] == 0x04 && ec_point[1] == 0x41 {
        &ec_point[2..]
    } else {
        ec_point
    };
    if raw.len() != 65 {
        bail!(
            "ec_point unexpected length {} (expected 65 raw or DER-wrapped)",
            raw.len()
        );
    }
    if raw[0] != 0x04 {
        bail!(
            "ec_point not uncompressed (expected 0x04 marker, got 0x{:02x})",
            raw[0]
        );
    }
    let pk = PublicKey::from_slice(raw).context("invalid secp256k1 point")?;
    Ok(pubkey_to_eth_address(&pk))
}

/// Keccak-256 hash.
fn keccak256(data: &[u8]) -> [u8; 32] {
    use sha3::{Digest, Keccak256};
    let mut h = Keccak256::new();
    h.update(data);
    let out = h.finalize();
    let mut a = [0u8; 32];
    a.copy_from_slice(&out);
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use secp256k1::{Secp256k1, SecretKey};

    #[test]
    fn decode_compact_round_trip() {
        let r = [1u8; 32];
        let s = [2u8; 32];
        let mut buf = Vec::with_capacity(64);
        buf.extend_from_slice(&r);
        buf.extend_from_slice(&s);
        let (rr, ss) = decode_der_or_compact(&buf).unwrap();
        assert_eq!(rr.0, r);
        assert_eq!(ss.0, s);
    }

    #[test]
    fn decode_der_basic() {
        // SEQUENCE { INTEGER 0x01, INTEGER 0x02 } with left-padding
        // (the INTEGER values themselves are 1-byte).
        let der = vec![
            0x30, 0x06, // SEQUENCE, 6 bytes
            0x02, 0x01, 0x01, // INTEGER 1
            0x02, 0x01, 0x02, // INTEGER 2
        ];
        let (r, s) = decode_der_or_compact(&der).unwrap();
        // After left-padding to 32 bytes, r ends in 0x01 and s in 0x02.
        assert_eq!(r.0[31], 0x01);
        assert_eq!(s.0[31], 0x02);
        for i in 0..31 {
            assert_eq!(r.0[i], 0);
            assert_eq!(s.0[i], 0);
        }
    }

    #[test]
    fn decode_der_strips_leading_zero() {
        // INTEGER with high-bit set requires a leading 0x00.
        let der = vec![
            0x30, 0x08, // SEQUENCE, 8 bytes
            0x02, 0x02, 0x00, 0x80, // INTEGER 0x80 (with leading 0x00)
            0x02, 0x02, 0x00, 0x81, // INTEGER 0x81 (with leading 0x00)
        ];
        let (r, s) = decode_der_or_compact(&der).unwrap();
        assert_eq!(r.0[31], 0x80);
        assert_eq!(s.0[31], 0x81);
    }

    #[test]
    fn decode_der_rejects_bad_tag() {
        let bad = vec![0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02];
        assert!(decode_der_or_compact(&bad).is_err());
    }

    #[test]
    fn decode_der_rejects_short_buffer() {
        let bad = vec![0x30];
        assert!(decode_der_or_compact(&bad).is_err());
    }

    #[test]
    fn low_s_below_half_is_unchanged() {
        let s = Scalar32([0u8; 32]);
        let n = low_s_normalise(s);
        assert_eq!(n.0, [0u8; 32]);
    }

    #[test]
    fn low_s_at_half_is_unchanged() {
        let s = Scalar32(SECP256K1_N_HALF);
        let n = low_s_normalise(s);
        assert_eq!(n.0, SECP256K1_N_HALF);
    }

    #[test]
    fn low_s_above_half_is_flipped() {
        // s = n_half + 1 → n - s = n_half - 1
        let mut s = SECP256K1_N_HALF;
        // add 1 to LSB
        let mut carry: u16 = 1;
        for i in (0..32).rev() {
            let v = s[i] as u16 + carry;
            s[i] = (v & 0xff) as u8;
            carry = v >> 8;
            if carry == 0 {
                break;
            }
        }
        let n = low_s_normalise(Scalar32(s));
        // n - (n_half + 1) = n_half - 1
        let mut expected = SECP256K1_N_HALF;
        let mut borrow: i32 = 1;
        for i in (0..32).rev() {
            let v = expected[i] as i32 - borrow;
            if v < 0 {
                expected[i] = (v + 256) as u8;
                borrow = 1;
            } else {
                expected[i] = v as u8;
                borrow = 0;
            }
            if borrow == 0 {
                break;
            }
        }
        assert_eq!(n.0, expected);
    }

    #[test]
    fn round_trip_v_recovery_against_known_key() {
        // Generate a key, sign a message, manually serialise (r, s),
        // then recover v and confirm it points back to the same key.
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[0xab; 32]).unwrap();
        let pk = sk.public_key(&secp);
        let expected_addr = pubkey_to_eth_address(&pk);

        let msg_bytes = keccak256(b"VIGIL APEX FIND-007 closure test");
        let msg = Message::from_digest_slice(&msg_bytes).unwrap();
        let recov = secp.sign_ecdsa_recoverable(&msg, &sk);
        let (recid, compact) = recov.serialize_compact();
        let r = Scalar32::from_slice(&compact[0..32]).unwrap();
        let s = Scalar32::from_slice(&compact[32..64]).unwrap();

        let v = recover_v(&msg_bytes, &r, &s, &expected_addr).unwrap();
        // The recovery id we just computed should match what we got out.
        assert_eq!(v, recid.to_i32() as u8);
    }

    #[test]
    fn ec_point_round_trip() {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[0x42; 32]).unwrap();
        let pk = sk.public_key(&secp);
        let raw = pk.serialize_uncompressed();
        assert_eq!(raw.len(), 65);
        let addr = ec_point_to_eth_address(&raw).unwrap();
        assert_eq!(addr, pubkey_to_eth_address(&pk));
    }

    #[test]
    fn ec_point_handles_der_wrap() {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[0x43; 32]).unwrap();
        let pk = sk.public_key(&secp);
        let raw = pk.serialize_uncompressed();
        // Prepend DER OCTET-STRING tag + length 0x41 (65).
        let mut wrapped = Vec::with_capacity(67);
        wrapped.push(0x04);
        wrapped.push(0x41);
        wrapped.extend_from_slice(&raw);
        let addr = ec_point_to_eth_address(&wrapped).unwrap();
        assert_eq!(addr, pubkey_to_eth_address(&pk));
    }
}
