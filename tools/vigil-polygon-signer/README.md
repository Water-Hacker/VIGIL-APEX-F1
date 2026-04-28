# vigil-polygon-signer (Phase F3)

Host-side service that signs and broadcasts Polygon transactions on
behalf of `worker-anchor` (and any future worker that needs the
audit-chain signing key). The private key never leaves the YubiKey;
each `sign_and_send` requires a physical touch.

## Wire protocol

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

## Production wiring (TODO before enabling)

The Python reference in `main.py` covers RPC + tx construction. The
ECDSA-on-secp256k1 sign through the YubiKey's PIV slot 9c is delegated
to a small Rust helper compiled with the `secp256k1` C library bindings,
because Python `python-pkcs11` does not directly expose the recoverable-
signature variant Ethereum needs. The helper is invoked via subprocess.

Build steps (run on the host, once):

1. `apt install yubikey-manager opensc-pkcs11 libpcsclite-dev pkg-config rustc cargo`
2. `cd tools/vigil-polygon-signer/secp256k1-helper && cargo build --release`
3. `install -m 0755 target/release/yk-secp256k1 /usr/local/libexec/`
4. Enrol the PIV key: `ykman piv keys generate --algorithm ECCP256 9c -`
   (key is generated on-device; only the public key leaves the YubiKey)
5. `install -m 0755 main.py /opt/vigil/polygon-signer/main.py`
6. `useradd -r -s /usr/sbin/nologin vigil-signer`
7. `usermod -aG plugdev vigil-signer`  (USB device access)
8. `systemctl enable --now vigil-polygon-signer.service`

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
