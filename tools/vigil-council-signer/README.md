# vigil-council-signer

Per-user desktop service for the council vote signing path. Runs on a
council member's own workstation; never on the central server.

> **W-10 partial closure.** The doctrinal target (per
> `docs/weaknesses/W-10.md`) is a native desktop helper that uses
> `libykcs11` directly to drive the YubiKey for council vote signing,
> with WebAuthn reserved for accessibility-edge cases. This tool is
> the cryptographic core of that helper. The Tauri / Electron wrapper
> with EV-signed reproducible build is a follow-on (see "Deferred to
> Phase M3-M4" below); the bridge in `packages/security/src/council-
signer.ts` already prefers this helper when its socket is reachable
> and falls back to WebAuthn otherwise.

## Components

```
tools/vigil-council-signer/
├── rust-helper/          # PKCS#11 P-256 ECDSA signer (Rust binary)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs       # subprocess CLI: --mode pubkey|sign
│       └── sign.rs       # pure ECDSA / DER / low-S helpers + tests
├── main.py               # NDJSON-over-Unix-socket wrapper around the helper
└── README.md             # this file

packages/security/src/council-signer.ts  # Node-side bridge consumed by the dashboard
packages/security/__tests__/council-signer.test.ts  # 17 vitest tests pinning the bridge
```

## Wire protocol (Node client → Python service)

NDJSON over a per-user Unix socket
(`$XDG_RUNTIME_DIR/vigil/council-signer.sock`, mode 0600):

```
→ {"method":"get_pubkey","params":{}}\n
← {"ok":true,"result":"04<X 64 hex><Y 64 hex>"}\n
→ {"method":"sign","params":{"hash":"<64 hex chars>"}}\n
← {"ok":true,"result":{"r":"<64 hex>","s":"<64 hex>"}}\n
```

Mismatched method or any internal error returns
`{"ok":false,"error":"<message>"}\n` on a single line.

## Helper protocol (Python service → Rust helper)

Invoked as a subprocess. The helper does NOT speak NDJSON — Python
wraps it.

Mode `--mode pubkey`:

```
$ yk-council-signer --mode pubkey
04abc1234...      # uncompressed P-256 point, 130 hex chars; no touch
```

Mode `--mode sign`:

```
$ echo -n "<64 hex chars = SHA-256 digest>" | yk-council-signer --mode sign
<r_hex 64>|<s_hex 64>|ok    # YubiKey touch required for C_Sign
```

The trailing `ok` field is the helper's in-process self-verify result
— it confirms the (r, s) the token returned is a valid signature
against the token's own public key (defends against fault-injection
attacks on cheap clones).

Errors go to stderr; stdout is reserved for the result line. Exit
code is non-zero on any failure.

## Build steps (run on each council member's workstation, once)

1. Install build prerequisites:

   ```
   sudo apt install yubikey-manager opensc-pkcs11 libpcsclite-dev pkg-config \
                    build-essential curl ca-certificates python3
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   . "$HOME/.cargo/env"
   ```

2. Build the helper:

   ```
   cd tools/vigil-council-signer/rust-helper
   cargo build --release
   cargo test --release    # unit tests for DER decode + low-S + point parse + self-verify
   ```

3. Install the helper binary (per-user):

   ```
   mkdir -p ~/.local/libexec
   install -m 0755 target/release/yk-council-signer ~/.local/libexec/
   ```

4. Enrol the PIV key (one-time, on the workstation with the YubiKey
   plugged in):

   ```
   ykman piv keys generate --algorithm ECCP256 9c -
   ykman piv access change-pin            # set a PIN, written to the file below
   ```

   Store the PIN at `$XDG_RUNTIME_DIR/vigil/council_piv_pin` mode 0600
   owned by the user. The directory permissions are set up by the
   service on first run.

5. Install the systemd-user unit (optional but recommended for
   auto-start):

   ```
   mkdir -p ~/.config/systemd/user
   install -m 0644 infra/systemd/vigil-council-signer.user.service \
                   ~/.config/systemd/user/vigil-council-signer.service
   systemctl --user daemon-reload
   systemctl --user enable --now vigil-council-signer.service
   ```

   (Without systemd the user can just run `python3 main.py` from a
   terminal; the dashboard probes the socket and falls back to
   WebAuthn cleanly when the service is absent.)

## End-to-end smoke test (no Polygon network needed)

After build + install with a YubiKey enrolled:

```
# Fetch the public key (no touch)
echo '{"method":"get_pubkey","params":{}}' \
  | nc -U "$XDG_RUNTIME_DIR/vigil/council-signer.sock"

# Sign a fake 32-byte hash (TOUCH the YubiKey when it blinks)
echo '{"method":"sign","params":{"hash":"0000000000000000000000000000000000000000000000000000000000000001"}}' \
  | nc -U "$XDG_RUNTIME_DIR/vigil/council-signer.sock"
```

Expected: a `{"ok":true,"result":{"r":"<64 hex>","s":"<64 hex>"}}`
response in under 2 s including the touch.

## Env vars

| Var                     | Default                                                                          | Purpose                   |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| `COUNCIL_SIGNER_SOCKET` | `$XDG_RUNTIME_DIR/vigil/council-signer.sock`                                     | NDJSON listen socket path |
| `YK_HELPER_BIN`         | `<repo>/tools/vigil-council-signer/rust-helper/target/release/yk-council-signer` | Rust helper binary path   |
| `PKCS11_LIB`            | `/usr/lib/x86_64-linux-gnu/libykcs11.so`                                         | YubiKey PKCS#11 module    |
| `YUBIKEY_PIV_LABEL`     | `Council Vote Signing Key`                                                       | PIV slot label            |
| `YUBIKEY_PIN_FILE`      | `$XDG_RUNTIME_DIR/vigil/council_piv_pin`                                         | PIN file (mode 0600)      |
| `YK_TOKEN_LABEL`        | `YubiKey PIV #1`                                                                 | PKCS#11 token label       |

## Audit

The service does not write to the central audit chain — it runs on
the council member's workstation, not the central infrastructure.
The corresponding audit row is emitted by the **dashboard** when it
records the resulting vote signature (`vote.cast` TAL-PA action,
which already carries the signature blob and verifying public key).

## Why a separate service per user, not a host service

The YubiKey sits in a USB port on the council member's own laptop.
Each member has a different YubiKey with a different PIV key. The
service is necessarily per-user, per-workstation. This is the
opposite of the polygon-signer, which runs once on the central host
because there is exactly one Polygon-anchor key in the whole estate.

## Testing the cryptographic helpers without a YubiKey

The Rust crate's pure secp256r1 helpers (DER decode, low-S
normalisation, EC-point parse, signature verify) are unit-tested:

```
cd tools/vigil-council-signer/rust-helper
cargo test --release
```

These tests cover the mathematics independently of the hardware. The
hardware path (`mode_pubkey`, `mode_sign`) is necessarily tested
against a real YubiKey on the member's workstation.

The Node-side bridge in
`packages/security/src/council-signer.ts` is tested by spinning up
an in-process Unix-socket mock that mirrors the NDJSON contract —
17 vitest cases exercise every documented branch (missing socket,
malformed pubkey, error envelope, timeout, hex validation).

## Deferred to Phase M3-M4

The full W-10 doctrinal fix asks for:

1. A Tauri or Electron desktop wrapper around this service, with an
   EV-signed reproducible build the architect publishes for every
   release.
2. Council member onboarding flow during the §13 enrolment ceremony
   that installs the wrapper + this service in one step.
3. A signed-binary verification mechanism (e.g. `sigstore`-anchored
   `cosign` signature on the helper binary) so a council member's
   workstation refuses to run a tampered helper.

The cryptographic core (this directory) is the load-bearing part —
the wrapper is a UX shell around it. Shipping the wrapper without
the helper would be the wrong order; this work lets the wrapper be
built directly on a hardened substrate when M3-M4 starts.

## Cross-references

- `docs/weaknesses/W-10.md` — weakness ticket
- `docs/decisions/log.md` — DECISION-018 (council vote on-chain
  multi-sig design; the signature shape this helper emits matches
  the on-chain verifier's expectations)
- `packages/security/src/fido.ts` — WebAuthn fallback (still
  supported as the second-choice path for accessibility cases)
- `tools/vigil-polygon-signer/` — sibling helper (secp256k1, central
  host service) — mirror this directory's protocol so a reviewer
  sees one shape.
