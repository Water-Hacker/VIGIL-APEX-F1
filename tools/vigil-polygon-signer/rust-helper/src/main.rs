//! yk-secp256k1 — YubiKey PKCS#11 → Ethereum signature helper.
//!
//! Closes FIND-007 (whole-system-audit doc 10). Replaces the
//! `NotImplementedError` placeholder in `tools/vigil-polygon-signer/main.py`.
//!
//! Wire protocol (subprocess from main.py):
//!
//! Mode `--mode address`:
//!   stdin:  (nothing)
//!   stdout: 0x-prefixed Ethereum address hex on success
//!   exit 0 on success; non-zero on PKCS#11 or PIN failure
//!
//! Mode `--mode sign`:
//!   stdin:  64 hex chars = 32-byte big-endian keccak256 hash of the
//!           EIP-1559 RLP-encoded unsigned transaction
//!   stdout: `<r_hex>|<s_hex>|<v>` where r and s are 64 hex chars each
//!           (32-byte big-endian) and v is "0" or "1" (raw recovery id;
//!           Python adds 27 + chainId offset per EIP-155).
//!   exit 0 on success; non-zero on signing / recovery failure
//!
//! Env vars (mirror main.py defaults, override per host install):
//!   PKCS11_LIB          (default /usr/lib/x86_64-linux-gnu/libykcs11.so)
//!   YUBIKEY_PIV_LABEL   (default "Polygon Anchor Key")
//!   YUBIKEY_PIN_FILE    (default /run/vigil/secrets/yubikey_piv_pin)
//!   YK_TOKEN_LABEL      (default "YubiKey PIV #1")

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
use std::{env, fs, io::Read, path::PathBuf, process::ExitCode};

use crate::sign::{
    decode_der_or_compact, ec_point_to_eth_address, low_s_normalise, recover_v, Scalar32,
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
    env_or("YUBIKEY_PIV_LABEL", "Polygon Anchor Key")
}

fn token_label() -> String {
    env_or("YK_TOKEN_LABEL", "YubiKey PIV #1")
}

fn pin_path() -> PathBuf {
    PathBuf::from(env_or(
        "YUBIKEY_PIN_FILE",
        "/run/vigil/secrets/yubikey_piv_pin",
    ))
}

fn load_pin() -> Result<AuthPin> {
    let s = fs::read_to_string(pin_path())
        .with_context(|| format!("read PIN file {}", pin_path().display()))?;
    Ok(AuthPin::new(s.trim().to_string()))
}

fn open_pkcs11() -> Result<Pkcs11> {
    let pkcs11 = Pkcs11::new(pkcs11_lib_path()).context("load PKCS#11 module")?;
    pkcs11
        .initialize(CInitializeArgs::OsThreads)
        .context("PKCS#11 C_Initialize")?;
    Ok(pkcs11)
}

/// Find the slot whose token label matches YK_TOKEN_LABEL.
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

/// Find the public key (CKO_PUBLIC_KEY, CKK_EC, CKA_LABEL match) and
/// return the CKA_EC_POINT bytes.
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

/// Find the matching private key handle (same label).
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

fn mode_address() -> Result<()> {
    let pkcs11 = open_pkcs11()?;
    let slot = find_token_slot(&pkcs11)?;
    let session = pkcs11.open_ro_session(slot)?;
    let ec_point = read_ec_point(&session)?;
    let addr = ec_point_to_eth_address(&ec_point)?;
    let mut out = String::from("0x");
    out.push_str(&hex::encode(addr));
    println!("{out}");
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
            "stdin must be 64 hex chars (32-byte hash); got {} chars",
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

    let ec_point = read_ec_point(&session)?;
    let expected_addr = ec_point_to_eth_address(&ec_point)?;

    let priv_handle = find_private_key(&session)?;
    let der_sig = session
        .sign(&Mechanism::Ecdsa, priv_handle, &msg_hash)
        .context("PKCS#11 C_Sign (YubiKey will request touch)")?;

    let (r, s) = decode_der_or_compact(&der_sig)?;
    let s_norm = low_s_normalise(s);
    let v = recover_v(&msg_hash, &r, &s_norm, &expected_addr)?;

    println!(
        "{}|{}|{}",
        hex::encode(r.as_bytes()),
        hex::encode(s_norm.as_bytes()),
        v
    );
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    // Expect: --mode address  OR  --mode sign
    let mode = args
        .iter()
        .position(|a| a == "--mode")
        .and_then(|i| args.get(i + 1))
        .ok_or_else(|| anyhow!("usage: yk-secp256k1 --mode <address|sign>"))?;

    match mode.as_str() {
        "address" => mode_address(),
        "sign" => mode_sign(),
        other => bail!("unknown mode {:?} (expected address|sign)", other),
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
