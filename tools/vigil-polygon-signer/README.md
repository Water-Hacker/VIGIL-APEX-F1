# vigil-polygon-signer (Phase F3)

Host-side service that signs and broadcasts Polygon transactions on
behalf of `worker-anchor` (and any future worker that needs the
audit-chain signing key). The private key never leaves the YubiKey;
each `sign_and_send` requires a physical touch.

> **Status update 2026-05-11 — FIND-007 closure (whole-system-audit doc 10).**
> The `NotImplementedError` placeholder is gone. PKCS#11 ECDSA signing
>
> - Ethereum-compatible v recovery are now done by a small Rust crate
>   at `./rust-helper/`. Python keeps RPC, EIP-1559 tx construction, and
>   broadcast; the helper is the cryptographic boundary that touches
>   the YubiKey.

## Wire protocol (Python service to Node clients)

NDJSON over a Unix socket (`/run/vigil/polygon-signer.sock`, mode 0660):

```
→ {"method":"get_address","params":{}}\n
← {"ok":true,"result":"0xabc..."}\n
→ {"method":"sign_and_send","params":{"to":"0x..","data":"0x..","value":"0","chainId":"137"}}\n
← {"ok":true,"result":"0x<txhash>"}\n
```

Mismatched method or any internal error returns `{"ok":false,"error":"..."}\n`.
Each request is one line; the server returns one line and is ready for
the next request on the same socket connection. See
`packages/audit-chain/src/polygon-anchor.ts:UnixSocketSignerAdapter` for
the in-tree client (Phase B9 hardened).

## Helper protocol (Python service to Rust helper)

The Python service invokes the helper as a subprocess. The helper does
NOT speak the NDJSON protocol — Python wraps it.

Mode `--mode address`:

```
$ yk-secp256k1 --mode address
0xabc1234...                  # checksummed Ethereum address; no touch
```

Mode `--mode sign`:

```
$ echo -n "<64 hex chars = keccak256 hash>" | yk-secp256k1 --mode sign
<r_hex 64>|<s_hex 64>|<v 0-or-1>   # YubiKey touch required for C_Sign
```

Errors go to stderr; stdout is reserved for the result line. Exit code
is non-zero on any failure.

## Build steps (run on the production host, once)

1. Install build prerequisites:

   ```
   apt install yubikey-manager opensc-pkcs11 libpcsclite-dev pkg-config \
               build-essential curl ca-certificates python3-pip
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   . "$HOME/.cargo/env"
   ```

2. Build the helper:

   ```
   cd tools/vigil-polygon-signer/rust-helper
   cargo build --release
   cargo test --release    # unit tests for DER decode + low-S + v recovery
   ```

3. Install the helper binary:

   ```
   install -m 0755 target/release/yk-secp256k1 /usr/local/libexec/
   ```

4. Enrol the PIV key (one-time, on the host with the YubiKey plugged in):

   ```
   ykman piv keys generate --algorithm ECCP256 9c -          # key on device
   ykman piv objects import 9c-cert.pem                       # optional
   ykman piv access change-pin                                 # set PIN
   ```

   Then store the PIN at `/run/vigil/secrets/yubikey_piv_pin` mode 0400
   owned by `vigil-signer:vigil-signer` (the systemd unit's User+Group).

5. Install the Python service:

   ```
   pip install eth_account web3 python-pkcs11 hexbytes
   install -m 0755 main.py /opt/vigil/polygon-signer/main.py
   ```

6. Create the dedicated user + permissions:

   ```
   useradd -r -s /usr/sbin/nologin vigil-signer
   usermod -aG plugdev vigil-signer
   ```

7. Install and start the systemd unit:
   ```
   install -m 0644 ../../infra/systemd/vigil-polygon-signer.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now vigil-polygon-signer.service
   ```

## End-to-end test (Polygon Mumbai/Amoy testnet)

After build + install, with a YubiKey enrolled and the testnet wallet
funded:

```
# Fetch the EOA address (no touch)
echo '{"method":"get_address","params":{}}' \
  | nc -U /run/vigil/polygon-signer.sock

# Send a noop self-transfer (touch the YubiKey when prompted)
ADDR=$(... above ...)
echo "{\"method\":\"sign_and_send\",\"params\":{\"to\":\"$ADDR\",\"value\":\"1\",\"chainId\":\"80002\"}}" \
  | nc -U /run/vigil/polygon-signer.sock
```

Expected: an Amoy testnet tx hash you can resolve on
`https://amoy.polygonscan.com/tx/<hash>`.

## Env vars

| Var                   | Default                                | Purpose                          |
| --------------------- | -------------------------------------- | -------------------------------- |
| POLYGON_SIGNER_SOCKET | /run/vigil/polygon-signer.sock         | NDJSON listen socket path        |
| POLYGON_RPC_URL       | https://polygon-rpc.com                | Polygon RPC for tx broadcast     |
| POLYGON_CHAIN_ID      | 137                                    | Mainnet by default; Amoy = 80002 |
| YK_HELPER_BIN         | /usr/local/libexec/yk-secp256k1        | Rust helper binary path          |
| PKCS11_LIB            | /usr/lib/x86_64-linux-gnu/libykcs11.so | YubiKey PKCS#11 module           |
| YUBIKEY_PIV_LABEL     | Polygon Anchor Key                     | PIV slot label                   |
| YUBIKEY_PIN_FILE      | /run/vigil/secrets/yubikey_piv_pin     | PIN file (mode 0400)             |
| YK_TOKEN_LABEL        | YubiKey PIV #1                         | PKCS#11 token label              |

## Audit

Every successful sign is recorded in `audit.actions` via the watchdog
audit-row pipeline (F2), so a missing tx hash is visible in the
operator dashboard within one watchdog cycle.

## Why a host service, not a container

The YubiKey sits on a USB port on the host. Mounting the device into a
container would expose the entire YubiKey to whatever else runs in the
container (we can't isolate by PIV slot at the kernel level). Keeping
the signer on the host with `vigil-signer` UID + `plugdev` group lets us
constrain access to a single binary that talks NDJSON over a socket.

## Testing the cryptographic helpers without a YubiKey

The Rust crate's pure secp256k1 helpers (DER decode, low-S
normalisation, v recovery, EC-point → address mapping) are
exhaustively unit-tested:

```
cd tools/vigil-polygon-signer/rust-helper
cargo test --release
```

These tests cover the mathematics independently of the hardware. The
hardware path (`mode_address`, `mode_sign`) is necessarily tested
against a real YubiKey on the production host.
