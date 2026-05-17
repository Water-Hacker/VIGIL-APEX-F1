//! yk-council-signer — YubiKey PIV (P-256) ECDSA helper for the
//! council vote signing path.
//!
//! W-10 partial closure: replaces WebAuthn as the primary council
//! vote signing channel (WebAuthn becomes the fallback for
//! accessibility-edge cases). The helper is invoked by the local
//! NDJSON-over-Unix-socket service (`tools/vigil-council-signer/
//! main.py`) which the desktop wrapper (future Tauri) drives.
//!
//! Wire protocol (subprocess from main.py):
//!
//! Mode `--mode pubkey`:
//!   stdin:  (nothing)
//!   stdout: uncompressed P-256 point as 130 hex chars (65 bytes,
//!           0x04-prefixed); no touch required
//!
//! Mode `--mode sign`:
//!   stdin:  64 hex chars = 32-byte SHA-256 digest of the WebAuthn-
//!           shaped challenge body (`clientDataJSON` SHA-256)
//!   stdout: `<r_hex>|<s_hex>` (each 64 hex chars; low-S normalised)
//!           plus a third pipe-separated field "ok" iff the helper's
//!           in-process self-verify confirmed the (r, s) is valid
//!           against the token's public key
//!
//! Errors go to stderr; stdout is reserved for the result line.
//! Exit code is non-zero on any failure.
//!
//! Env vars (mirror polygon-signer naming so an SRE only learns one
//! schema):
//!   PKCS11_LIB           (default /usr/lib/x86_64-linux-gnu/libykcs11.so)
//!   YUBIKEY_PIV_LABEL    (default "Council Vote Signing Key")
//!   YUBIKEY_PIN_FILE     (default $XDG_RUNTIME_DIR/vigil/council_piv_pin)
//!   YK_TOKEN_LABEL       (default "YubiKey PIV #1")
//!
//! Security posture vs polygon-signer: the council-signer ships to
//! council-member workstations (not a server). The PIN file path
//! defaults to the user's $XDG_RUNTIME_DIR (tmpfs, per-user) rather
//! than /run/vigil, and the helper is intended to be invoked by an
//! unprivileged desktop process — not a systemd service.

mod sign;

use anyhow::{anyhow, bail, Context, Result};
use cryptoki::{
    context::{CInitializeArgs, Pkcs11},
    mechanism::Mechanism,
    object::{Attribute, AttributeType, KeyType, ObjectClass},
    session::UserType,
    slot::Slot,
    types::AuthPin,
};
use std::{
    env, fs,
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    process::ExitCode,
};

use crate::sign::{
    compact_signature, decode_der_or_compact, low_s_normalise, normalise_ec_point,
    verify_signature, Scalar32,
};

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn pkcs11_lib_path() -> PathBuf {
    PathBuf::from(env_or(
        "PKCS11_LIB",
        "/usr/lib/x86_64-linux-gnu/libykcs11.so",
    ))
}

fn key_label() -> String {
    env_or("YUBIKEY_PIV_LABEL", "Council Vote Signing Key")
}

fn token_label() -> String {
    env_or("YK_TOKEN_LABEL", "YubiKey PIV #1")
}

fn pin_path() -> PathBuf {
    // Default to a per-user tmpfs location — this helper runs on a
    // council member's workstation, NOT the central server. Setting
    // XDG_RUNTIME_DIR is automatic on every systemd-logind session.
    if let Ok(rt) = env::var("YUBIKEY_PIN_FILE") {
        return PathBuf::from(rt);
    }
    let xdg = env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(format!("{xdg}/vigil/council_piv_pin"))
}

/// Same pre-flight as polygon-signer: refuse to read the PIN file
/// if it's group- or world-readable.
fn check_pin_file_mode(p: &Path) -> Result<()> {
    let meta = fs::metadata(p)
        .with_context(|| format!("stat PIN file {}", p.display()))?;
    if !meta.is_file() {
        bail!("PIN file {} is not a regular file", p.display());
    }
    let mode = meta.mode() & 0o777;
    if mode & 0o077 != 0 {
        bail!(
            "PIN file {} has unsafe mode {:o} (group/world bits set); \
             require 0o400 or 0o600",
            p.display(),
            mode,
        );
    }
    Ok(())
}

fn load_pin() -> Result<AuthPin> {
    let p = pin_path();
    check_pin_file_mode(&p)?;
    let s = fs::read_to_string(&p)
        .with_context(|| format!("read PIN file {}", p.display()))?;
    Ok(AuthPin::new(s.trim().to_string()))
}

fn open_pkcs11() -> Result<Pkcs11> {
    let pkcs11 = Pkcs11::new(pkcs11_lib_path()).context("load PKCS#11 module")?;
    pkcs11
        .initialize(CInitializeArgs::OsThreads)
        .context("PKCS#11 C_Initialize")?;
    Ok(pkcs11)
}

fn find_token_slot(pkcs11: &Pkcs11) -> Result<Slot> {
    let target = token_label();
    for slot in pkcs11.get_slots_with_initialized_token()? {
        let info = pkcs11.get_token_info(slot)?;
        if info.label().trim() == target {
            return Ok(slot);
        }
    }
    bail!(
        "no PKCS#11 token labelled {:?} (looked at {} initialised slots)",
        target,
        pkcs11.get_slots_with_initialized_token()?.len(),
    );
}

fn read_ec_point(session: &cryptoki::session::Session) -> Result<Vec<u8>> {
    let label = key_label();
    let template = vec![
        Attribute::Class(ObjectClass::PUBLIC_KEY),
        Attribute::KeyType(KeyType::EC),
        Attribute::Label(label.as_bytes().to_vec()),
    ];
    let mut iter = session.find_objects(&template)?.into_iter();
    let handle = iter
        .next()
        .ok_or_else(|| anyhow!("no public key with label {:?}", label))?;
    let attrs = session.get_attributes(handle, &[AttributeType::EcPoint])?;
    for a in attrs {
        if let Attribute::EcPoint(bytes) = a {
            return Ok(bytes);
        }
    }
    bail!("public key has no CKA_EC_POINT attribute")
}

fn find_private_key(
    session: &cryptoki::session::Session,
) -> Result<cryptoki::object::ObjectHandle> {
    let label = key_label();
    let template = vec![
        Attribute::Class(ObjectClass::PRIVATE_KEY),
        Attribute::KeyType(KeyType::EC),
        Attribute::Label(label.as_bytes().to_vec()),
    ];
    let mut iter = session.find_objects(&template)?.into_iter();
    iter.next()
        .ok_or_else(|| anyhow!("no private key with label {:?}", label))
}

fn mode_pubkey() -> Result<()> {
    let pkcs11 = open_pkcs11()?;
    let slot = find_token_slot(&pkcs11)?;
    let session = pkcs11.open_ro_session(slot)?;
    let raw = read_ec_point(&session)?;
    let point = normalise_ec_point(&raw)?;
    println!("{}", hex::encode(point));
    Ok(())
}

fn mode_sign() -> Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("read message hash from stdin")?;
    let hex_str = input.trim().trim_start_matches("0x");
    if hex_str.len() != 64 {
        bail!(
            "stdin must be 64 hex chars (32-byte SHA-256 digest); got {} chars",
            hex_str.len()
        );
    }
    let mut msg_hash = [0u8; 32];
    hex::decode_to_slice(hex_str, &mut msg_hash).context("decode hex message hash")?;

    let pkcs11 = open_pkcs11()?;
    let slot = find_token_slot(&pkcs11)?;
    let session = pkcs11.open_rw_session(slot)?;
    session
        .login(UserType::User, Some(&load_pin()?))
        .context("PKCS#11 login (PIN read from YUBIKEY_PIN_FILE)")?;

    let raw_point = read_ec_point(&session)?;
    let pubkey = normalise_ec_point(&raw_point)?;

    let priv_handle = find_private_key(&session)?;
    let der_sig = session
        .sign(&Mechanism::Ecdsa, priv_handle, &msg_hash)
        .context("PKCS#11 C_Sign (YubiKey will request touch)")?;

    let (r, s) = decode_der_or_compact(&der_sig)?;
    let s_norm = low_s_normalise(s);
    let _ = compact_signature(&r, &s_norm); // self-test the encoder

    // Self-verify — confirms the token actually signed correctly,
    // not a fault-injection attack. Defensive against firmware bugs
    // and the rare class of attacks that flip a bit between C_Sign
    // and the helper. Cheap (~70 µs on commodity CPUs).
    verify_signature(&pubkey, &msg_hash, &r, &s_norm)
        .context("self-verify failed: token returned an invalid signature")?;

    println!(
        "{}|{}|ok",
        hex::encode(r.as_bytes()),
        hex::encode(s_norm.as_bytes())
    );
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let mode = args
        .iter()
        .position(|a| a == "--mode")
        .and_then(|i| args.get(i + 1))
        .ok_or_else(|| anyhow!("usage: yk-council-signer --mode <pubkey|sign>"))?;
    match mode.as_str() {
        "pubkey" => mode_pubkey(),
        "sign" => mode_sign(),
        other => bail!("unknown mode {:?} (expected pubkey|sign)", other),
    }
}

fn main() -> ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .target(env_logger::Target::Stderr)
        .init();
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("ERROR: {err:#}");
            ExitCode::FAILURE
        }
    }
}
