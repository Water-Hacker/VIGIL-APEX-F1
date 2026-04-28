REPUBLIQUE DU CAMEROUN  -  REPUBLIC OF CAMEROON
Paix  -  Travail  -  Patrie
VIGIL APEX
HARDWARE SECURITY KEY
OPERATIONS MANUAL
YubiKey 5C NFC Pair
Version 1.0  -  April 2026

RESTRICTED  -  HOLD AT THE LEVEL OF THE COMMISSIONING BODY


### 1.1  Why This Manual Exists
The VIGIL APEX platform handles politically sensitive forensic findings about public procurement. Every action that produces, signs, transmits, or anchors a finding is gated by a single physical artefact: the YubiKey 5C NFC. The cryptographic strength of the platform is, in practice, the operational discipline around two small pieces of metal and plastic. This manual exists so that discipline is documented, repeatable, auditable, and survivable - not held only in the head of the Technical Director.
A reviewer asking 'what happens if you lose your YubiKey?' should receive a written answer with specific procedures and time bounds, not improvised reassurance. A backup architect activating in an emergency should be able to follow this document end-to-end without the original Technical Director being available. An independent auditor verifying institutional readiness should be able to test every claim against the procedures recorded here.

### 1.2  What This Manual Covers

### 1.3  What This Manual Does NOT Cover
This manual is operationally focused. The following are deliberately out of scope:
Cryptographic primitives. The choice of curve (Ed25519), the FIDO2 protocol, and the OpenPGP keypair generation parameters are documented in the Security Requirements Document (CORE_SRD).
Why YubiKey rather than a competing product. The hardware selection rationale is in CORE_SRD Section on hardware-rooted authentication.
Server-side configuration of the systems being protected. Configuring DSM 7.2 to require FIDO2, configuring Vault auto-unseal, configuring sshd for hardware-key auth - those configurations are in CORE_BUILD_COMPANION.
Full smart-contract / blockchain wallet security. The Polygon wallet integration is one of seven uses; the wallet itself is documented in the CORE_BUILD_COMPANION contracts section.



### 2.1  Physical Description
The YubiKey 5C NFC is a small, USB-C, fixed-form-factor hardware security key roughly the size of a flash drive (45 mm x 18 mm x 3.3 mm, 4 g). It is moulded glass-fibre reinforced plastic with a metal contact pad on one face (the gold disc - the touch sensor) and a USB-C connector on one end. There is a keychain hole at the other end. It is rated IP68 against dust and water immersion, and physically crushproof under typical pocket / keychain conditions.
The device has no battery. It draws power from the USB host when plugged in, and from the NFC field when tapped against an NFC reader. There is no display. There is no internet connection. Once provisioned, the YubiKey performs a small set of cryptographic operations on demand and otherwise sits inert.
The firmware is signed by Yubico and is intentionally NOT user-updateable. This is a deliberate security property: a YubiKey shipped with firmware version X retains that version for life. There is no remote attack surface that could push malicious firmware. The trade-off is that if a vulnerability is found in a firmware version, the key must be physically replaced rather than patched.

### 2.2  Internal Capabilities
A single YubiKey 5C NFC is several distinct security devices in one shell. Each capability is independent and uses a separate internal applet.


### 2.3  Connection Modes
The 5C NFC variant supports two connection modes; the key is functionally identical in either mode.


### 2.4  Touch Requirement
Every cryptographic operation that produces a signature, decrypts data, or releases a credential requires a physical touch on the gold contact disc. This is the user-presence proof that distinguishes a YubiKey from a software credential. Malware on the host computer cannot 'pretend' to touch the key. A remote attacker controlling the laptop fully cannot make the key sign anything without you, physically present, touching it.
The gold disc is capacitive (responds to skin) and only activates while pressed. There is no biometric reading - no fingerprint match, no identity check. The touch only proves a human is present at the device. PIN entry separately proves which human.

### 2.5  Lifecycle


### 3.1  The Single-Key Failure Mode
Consider what happens if the platform relies on a single YubiKey and that key is lost. The architect cannot log into the MSI Titan (BitLocker won't unlock). The architect cannot SSH to Hetzner. The architect cannot unseal Vault. The architect cannot sign a dossier. The architect cannot enter 2FA codes for Anthropic, AWS, GitHub - meaning even password-based fallback is unavailable because every account requires the second factor.
In practical terms: the loss of a single key without a backup means every credential in the platform must be recovered through whatever break-glass mechanism the underlying system offers (cloud account recovery, BitLocker recovery key, LUKS recovery passphrase, GPG revocation certificate, etc.) - and each of those recovery flows is itself a security-sensitive event that takes hours to days. The MVP cannot afford that downtime.

### 3.2  The Pair Model
The pair model solves the single-key failure mode by maintaining two YubiKeys, provisioned identically at the same moment, that are functionally interchangeable. Either key, presented with the correct PIN, performs every action the other can perform. Losing one is inconvenient but not catastrophic: the other becomes the new primary while a replacement is procured.


### 3.3  Custody Of The Pair


### 3.4  When The Backup Becomes The Primary
The backup converts to primary status the moment the original primary becomes unavailable for any reason - lost, stolen, damaged, compromised. The transition is operational: the architect retrieves the backup from the safe and begins using it as the daily key. There is no cryptographic action required because both keys are already enrolled to every service.
Within 24 hours of the transition, the architect must initiate procurement of a replacement YubiKey (Section 10). Once the replacement arrives and is provisioned identically, it becomes the new backup, restoring the pair. Until then, the platform is running on a single key - this is the elevated-risk state and must be exited as quickly as procurement allows.


The YubiKey pair gates seven distinct systems on VIGIL APEX. Each is described below with: (a) the cryptographic mechanism, (b) the procedure when the key is present, (c) what fails when no key is available, and (d) the corresponding break-glass recovery path.

### 4.1  MSI Titan Disk Encryption (BitLocker)
Mechanism
The MSI Titan's primary 2 TB Gen5 NVMe drive is fully encrypted with BitLocker AES-256-XTS. The drive's master key is sealed by a TPM 2.0 protector AND a YubiKey-based PIN protector (configured via the YubiKey PIV applet). At boot, BitLocker requires both the TPM (which silently confirms the boot chain is unmodified) AND the YubiKey + PIN. Without both, the drive is unreadable noise.
Procedure
Power on the MSI Titan. The BitLocker pre-boot screen appears asking for the PIV PIN. Plug the YubiKey into a USB-C port. Type the 6-digit PIV PIN. BitLocker verifies the PIV credential against the YubiKey, releases the drive's master key, and Windows boots. Remove the YubiKey if leaving the desk; BitLocker does not require continuous presence after boot, but the YubiKey is needed for the next boot.
What Fails Without A Key
The Titan does not boot. The drive cannot be mounted on another machine without the BitLocker recovery key. All local Docker volumes, Neo4j data files (NOT on the NAS), and source code working copies are inaccessible. Note: the production data on the Synology NAS is not affected because that storage is protected separately.
Break-Glass Recovery
The 48-character BitLocker recovery key is printed on paper and sealed in the fireproof safe at the architect's residence. With the recovery key, the drive can be unlocked once on any machine. The recovery key is rotated immediately after each break-glass use. Microsoft also stores a copy in the architect's enterprise M365 account; this copy is the second-line backup but is NOT the primary recovery path because account compromise is a higher probability than safe compromise.

### 4.2  Synology NAS Admin (Both Primary And Remote Replica)
Mechanism
Synology DSM 7.2 supports FIDO2 / WebAuthn for admin login. Both NAS units (vigil-storage-01 at the primary site, vigil-storage-02 at the remote site) are configured to require a FIDO2 credential for any admin-level operation. Both YubiKeys are enrolled as FIDO2 credentials on both NAS units at provisioning. Username + password alone is REJECTED for admin actions.
Procedure
Open the Synology web interface (https://vigil-storage-01.local:5001 or the remote replica's address). Enter username and password. DSM presents a FIDO2 prompt. Plug in the YubiKey, type the PIN, touch the gold disc. DSM verifies and grants admin session. The session has a configurable timeout (default 30 minutes); after timeout, the FIDO2 prompt repeats.
What Fails Without A Key
No admin actions on either NAS. The NAS continues serving NFS shares, hosting the running containers (vigil-db, vigil-sec), and replicating between primary and remote. But: Snapshot Replication cannot be reconfigured. Failover cannot be initiated. New shares cannot be created. New users cannot be added. The system runs but cannot be administered.
Break-Glass Recovery
DSM has a recovery account that can be activated by physical access to the NAS unit (4-second power button reset of admin password). This requires being physically at the NAS - which is intentional. For the remote NAS, this means physically travelling to the remote site. The reset opens a 60-second window during which a new password can be set; FIDO2 enrolment must then be redone.

### 4.3  SSH Access To Hetzner Cloud (Node N02)
Mechanism
The Hetzner CPX31 VPS hosting the ingestion node N02 is configured to accept SSH only via key-based authentication, NOT password. The architect's SSH client is configured to use the YubiKey's PIV applet as the SSH credential source via PKCS#11. The SSH private key never exists on the laptop's disk - it lives inside the YubiKey hardware. Each SSH connection requires the architect to plug in the YubiKey and touch the gold disc; the touch authorises one SSH handshake.
Procedure
Open a terminal. Run 'ssh root@hetzner-vigil-ingest'. The SSH client invokes the PKCS#11 module pointing at the YubiKey. The YubiKey blinks, requesting touch. Touch the gold disc. The handshake completes; the shell prompt appears. To run a long sequence of commands without re-touching, ssh-agent forwarding holds the credential for the session duration.
What Fails Without A Key
No SSH to Hetzner. The ingestion node continues running (Docker containers do not stop on SSH unavailability). New deployments cannot be pushed via SSH. Configuration cannot be examined or modified. Logs cannot be tailed remotely. If a container crashes and needs manual restart, no remote restart is possible until SSH access is restored.
Break-Glass Recovery
The Hetzner web console (https://console.hetzner.cloud) provides a browser-based VNC session into the VPS that does NOT require SSH key authentication - it uses Hetzner account credentials + 2FA. The 2FA uses the same YubiKey, BUT it can be alternatively satisfied by a recovery code stored in the safe. The web console is slower and clunkier than SSH, but it is a fully functional fallback path for emergency access.

### 4.4  HashiCorp Vault Unsealing
Mechanism
HashiCorp Vault running in container N10 (vigil-sec) starts in 'sealed' state on every boot. Sealed Vault cannot return any secret to any caller, even with valid auth tokens. Unsealing requires the assembly of a Shamir's Secret Sharing key split into 5 shares, of which 3 are required to reconstruct (3-of-5 threshold). One of those shares is held on the YubiKey via the challenge-response applet; the architect's touch produces an HMAC of a Vault-supplied challenge that yields the share.
Procedure
After any Vault restart, the unseal procedure must run. Connect to vault-server, run 'vault operator unseal'. Vault challenges three of the five share-holders. The architect's YubiKey responds to one challenge (touch required). The other two shares come from: (a) a paper share in the safe at the residence, and (b) a paper share held by the named backup architect in their separate location. With the threshold met, Vault unseals.
What Fails Without A Key
If Vault restarts and remains sealed, NO secret in the platform is accessible. Anthropic API key cannot be retrieved by vigil-core. Database passwords cannot be retrieved by vigil-db. Polygon wallet seed cannot be retrieved by vigil-chain. Every container that needs a secret to function fails its health check on startup. The platform effectively halts.
Break-Glass Recovery
3-of-5 Shamir threshold means even WITHOUT the YubiKey share, the threshold can be met using the safe paper share + backup architect paper share + a third optional share held by a designated trusted institutional partner (CONAC senior security officer or equivalent, custody documented in the SOW confidential annex). This is the strongest break-glass design in the platform: no single party - including the architect - can unilaterally hold Vault hostage.

### 4.5  GPG Signing Of Every Dossier
Mechanism
Every dossier generated by the auto-dossier pipeline (container N06 vigil-dossier) before SFTP transfer to CONAC is GPG-signed with the architect's OpenPGP key. The OpenPGP key is generated entirely INSIDE the YubiKey at provisioning - the private key never exists on disk, never in memory, never on a backup. Signing operations are performed by the YubiKey itself in response to a touch; the host computer sends the document hash to the key, the key signs, and returns the signature.
Procedure
The auto-dossier pipeline emits a finalised PDF and submits it to gpg-agent for signing. gpg-agent prompts the architect (via system notification) for the signing PIN if not cached, then prompts for a touch. The YubiKey blinks. The architect touches the gold disc. The signature is appended to the PDF. The pipeline transfers the signed PDF to CONAC SFTP. The architect's GPG public key is on the CONAC OpenPGP keyring; CONAC verifies the signature on receipt.
What Fails Without A Key
No dossier can be signed. No dossier can be transmitted to CONAC. The auto-dossier pipeline queues unsigned dossiers in a holding directory for later signing; the queue grows until a key is available. CONAC receives nothing during the outage.
Break-Glass Recovery
This is the ONLY system in this list with no automatic break-glass path. The OpenPGP key cannot be restored from a backup because there is no backup - that is the point. If both YubiKeys (with the same OpenPGP key) are lost, the OpenPGP key is permanently gone, and a new key must be generated, published, and re-distributed to CONAC. Past dossiers remain valid under the old signature; new dossiers will be signed with the new key. The transition is documented in the formal CONAC notification and a dossier-signing-key-rotation log entry on the Hyperledger ledger.

### 4.6  Two-Factor Authentication For All Platform Accounts
Mechanism
Every web account that supports TOTP-based 2FA has its TOTP secret stored on both YubiKeys via the OATH applet. The Yubico Authenticator app on the architect's phone (or laptop) talks to the YubiKey to request a 6-digit code; the YubiKey computes the code from its on-card secret and the current time. The code is valid for 30 seconds. The phone displays the code. The architect types it into the website.
Procedure
Open the website (Anthropic Console, AWS, Hetzner, Cloudflare, GitHub, M365, Synology Account, etc.). Sign in with username and password. Site prompts for 2FA code. Open Yubico Authenticator on the phone. Plug or NFC-tap the YubiKey to the phone. Authenticator shows the 6-digit code. Type it into the website.
What Fails Without A Key
Cannot complete 2FA. Cannot log in to any account that requires 2FA - which is every account that matters. Password alone is insufficient.
Break-Glass Recovery
Each account, at the time it was protected with 2FA, generated a one-time set of recovery codes (typically 10 single-use codes per account). These codes are printed on paper and held in the safe. With a recovery code, login is possible without the YubiKey. After successful login, 2FA must be re-enrolled with a fresh secret on a replacement YubiKey before the account is considered restored to normal protection state.

### 4.7  Polygon Wallet For Blockchain Anchoring
Mechanism
VIGILAnchor.sol on Polygon mainnet records the SHA-256 hash of every signed dossier and every governance quorum signature event. Calls to the contract are signed transactions originating from the architect's Polygon wallet. The wallet's secp256k1 private key is stored in YubiKey PIV slot 9C (Digital Signature). Each contract call requires the YubiKey + PIN + touch to produce the signature.
Procedure
Container N03 (vigil-chain) prepares the unsigned transaction and submits it to the architect's signing endpoint. The endpoint invokes the YubiKey via PIV. The YubiKey blinks. The architect touches the gold disc. The signed transaction is broadcast to the Polygon network via the Alchemy RPC endpoint. Confirmation arrives within seconds. The transaction hash is recorded as the on-chain proof.
What Fails Without A Key
No on-chain anchoring. Findings are still generated locally and signed with GPG (Section 4.5), but they are not committed to the public Polygon ledger. The cryptographic durability claim weakens: a finding is provably authentic via GPG, but its existence is not yet public-ledger-attested. Pending findings queue locally awaiting a key.
Break-Glass Recovery
The Polygon wallet seed phrase (24 words) is split via Shamir 3-of-5 identical to the Vault unseal scheme: one share on each YubiKey, one paper share in the safe, one paper share with the backup architect, one paper share with the trusted institutional partner. Reconstructing the seed phrase requires 3 of 5 shares - again, the architect alone cannot unilaterally exercise the wallet, and emergency recovery is possible without the architect.



Provisioning happens once, during M0 mobilisation, before any production data exists. The procedure below MUST be followed start-to-finish in a single working day - splitting it across days creates partial states that are confusing and increase mistake risk. Both keys are provisioned in the same session so they are guaranteed identical.

### 5.1  Pre-Requisites
Two new, sealed YubiKey 5C NFC units, purchased from Yubico's authorised distributor. Verify the holographic seal on each blister pack before opening; reject any pack with a broken or tampered seal.
A working laptop with USB-C, internet access, and the following software installed: yubikey-manager (CLI: ykman), Yubico Authenticator (desktop), GnuPG 2.4+, OpenSSH client with PKCS#11 support, scdaemon.
A clean working environment: a private room, no shoulder-surfers, phones face-down. The PIN you choose is recorded only in your head.
A printed paper sheet for recording: each key's serial number, the chosen PIN (sealed envelope, deposited in safe before leaving the room), the OpenPGP key fingerprint, and the architect's signature confirming the procedure was followed.
The fireproof safe accessible at the end of the session.
Approximately 3 hours of uninterrupted time.

### 5.2  Step 1 - Initial Inspection And Firmware Check
Open both blister packs. Plug in YubiKey #1. Run 'ykman info'. Record the firmware version (should be 5.7.x or newer for FIDO2 + OpenPGP capability), the serial number, and the form factor. Repeat for YubiKey #2. Both keys should report the same firmware version; if they differ, contact Yubico before proceeding (this is rare but happens with mixed-batch shipments).

### 5.3  Step 2 - Disable Unused Applets
By default, YubiKey 5C NFC ships with all applets enabled. Disable Yubico OTP and Static Password to reduce attack surface. On each key:
Verify with 'ykman config usb' that only FIDO2, U2F, OPENPGP, PIV, and OATH remain enabled. Repeat on the second key.

### 5.4  Step 3 - Set The PIV PIN, PUK, And Management Key
PIV is the smartcard applet that holds the BitLocker, SSH, and Polygon wallet credentials. Choose an 8-digit PIV PIN. The same PIN is used on BOTH keys. The PUK (PIN Unlock Key) is a recovery PIN used if the user PIN is locked; choose a different 8-digit PUK from the PIN. The Management Key is a 24-byte hex value used to administer the PIV applet; randomly generate it and record it sealed in the safe.
Both keys now have identical PIV access credentials.

### 5.5  Step 4 - Generate The Polygon Wallet (PIV slot 9C)
PIV slot 9C (Digital Signature) holds the secp256k1 private key for the Polygon wallet. Generate a wallet seed phrase OFFLINE on a separate air-gapped machine, derive the secp256k1 keypair from the seed using BIP-39 + BIP-44, and inject the private key into both YubiKeys' slot 9C. Do NOT generate on the YubiKey itself for this slot - we want a recoverable seed for the Shamir-split break-glass. Split the seed phrase into 5 Shamir shares (3-of-5 threshold).
Distribute shares: Share 1 -> YubiKey #1 OATH (encoded as a TOTP-format secret for storage convenience); Share 2 -> YubiKey #2 OATH; Share 3 -> sealed paper in the safe; Share 4 -> sealed paper in the backup architect's custody; Share 5 -> sealed paper in the institutional partner's custody.

### 5.6  Step 5 - Generate The OpenPGP Key (On-Card)
Unlike the Polygon wallet, the OpenPGP key for dossier signing is generated INSIDE the YubiKey. The private key never exists outside the hardware. Because of this, generating identical OpenPGP keys on both YubiKeys requires a specific procedure: generate on YubiKey #1, then export the key blob via secret-key transfer to YubiKey #2. This is the ONLY situation in this manual where private key material moves between two devices, and it happens only inside a controlled provisioning session.
Both keys now hold the same OpenPGP keypair. Verify by signing a test file with each key and confirming the signatures verify against a single public key.

### 5.7  Step 6 - Enroll FIDO2 Credentials
For each FIDO2-protected service (Synology DSM, GitHub, Anthropic Console, Hetzner Cloud, etc.), enroll BOTH YubiKeys at the same time. Most services support 'add another security key' in their security settings. Add YubiKey #1, complete the touch flow, then add YubiKey #2 with the same flow. If a service supports only one key, that is a configuration limit - use it for the primary and document the exception (Synology supports multiple, GitHub supports multiple, AWS supports multiple).

### 5.8  Step 7 - Enroll TOTP Secrets
For each web account that uses TOTP (typically 10-15 accounts: Anthropic Console, AWS, Hetzner, Cloudflare, GitHub, M365, Synology Account, the SAS bank, the SAS accounting tool, OpenCorporates dashboard, Maxar dashboard, etc.):
Open the account's security settings.
Initiate 'Add new authenticator app'.
Reveal the QR code OR the otpauth:// URI.
Open Yubico Authenticator (desktop). Plug YubiKey #1. Click 'Add account'. Either scan the QR or paste the URI. Save.
Without dismissing the account's enrolment screen, plug YubiKey #2. Repeat the add. Save.
Now enter the current 6-digit code from EITHER key into the account's confirmation field. The account is enrolled with both keys simultaneously holding the same secret.
Generate the account's recovery codes, print them, seal in safe envelope.

### 5.9  Step 8 - Configure BitLocker On The MSI Titan
With the YubiKey PIV slot 9A populated (per Step 4 - or use a separate slot for BitLocker if Polygon uses 9C), enable BitLocker on the Titan using the YubiKey + PIN protector. Microsoft's manage-bde tool supports YubiKey via the PIV smartcard interface. Generate the BitLocker recovery key, print it, seal in safe envelope. Verify boot succeeds with EACH YubiKey individually before declaring BitLocker provisioned.

### 5.10  Step 9 - Configure Vault Unseal Share
Generate the Shamir 5-share split of the Vault root unseal key. Distribute identically to the Polygon seed: 1 share on each YubiKey (encoded via challenge-response slot), 1 in safe, 1 with backup architect, 1 with institutional partner. Test the unseal: simulate a Vault restart, perform unseal using the architect's YubiKey + 2 paper shares (architect can perform a 3-share unseal alone in test conditions).

### 5.11  Step 10 - Verification Battery
Before declaring provisioning complete, run the following tests with EACH key independently:

### 5.12  Step 11 - Provisioning Attestation
Print the provisioning attestation document (Appendix C template). Record on it: the date and time, both YubiKey serial numbers, the OpenPGP key fingerprint, the BitLocker recovery key SHA-256 (NOT the recovery key itself - just a hash to verify integrity later), the Polygon wallet address, every test result from Step 10. Sign the attestation. Deposit signed attestation in safe alongside the backup YubiKey.


### 6.1  Morning Startup

### 6.2  During The Working Day
Most operations during the working day silently use the SSH agent or the cached PIV PIN. The YubiKey blinks and requests a touch only for: signing a dossier (each one), unsealing Vault (rare - only after a restart), signing a Polygon transaction (one per finding), or initiating a fresh SSH connection from a new shell (cached for a configurable period via ssh-agent).
Touching the disc is a 0.5-second action. It happens dozens of times per day. Treat it as routine, the way one types a password without conscious thought - but maintain the habit of NEVER touching the disc unless an action you initiated is requesting authorisation. If the key blinks unexpectedly (no action you started should need the key right now), DO NOT touch. Investigate immediately - this is a strong signal that something on the host computer is requesting an unauthorised cryptographic operation.

### 6.3  Field Operations (Away From The Office)
When the architect is mobile - travelling to CONAC, MINFI, an institutional event, a regional government office - the primary YubiKey travels on the architect's person. The MSI Titan is closed and powered off (or hibernated). Field operations typically use the architect's phone with NFC tap for any authentication needs.
Operational rules in the field:
The YubiKey is on a sturdy keychain or lanyard around the neck, not loose in a pocket where it can fall out.
Never leave the YubiKey unattended - not in a hotel room safe (those are not secure), not in a car, not at a restaurant table.
If unplugged from a host computer, no operation can occur. Sleeping the laptop with the key plugged in is acceptable for short periods (lunch); for any absence longer than 15 minutes, unplug the key and take it with you.
NFC operations on the phone: tap the back of the phone to the YubiKey. The phone must already have the relevant Yubico Authenticator app open to receive the tap. After the operation completes (typically 1-2 seconds), the YubiKey returns to the keychain.

### 6.4  End Of Day

### 6.5  Synology DSM Admin Operations
Routine NAS administration (checking replication, examining logs, applying DSM updates, adjusting shared folder permissions) requires the YubiKey for FIDO2 admin login. The procedure is:
Open the NAS web interface in browser.
Username + password.
FIDO2 prompt -> touch YubiKey gold disc.
Perform the admin task.
Log out (do NOT close the browser tab without logging out - this leaves the session valid until DSM's idle timeout).

### 6.6  Dossier Signing Workflow
Auto-dossier pipeline reaches the signing stage. The architect receives a desktop notification: 'Dossier 2026-04-27-001 ready for signature'. The architect:
Reviews the dossier preview in the Operations Room UI (5-10 seconds for a routine dossier; longer for politically sensitive ones).
Clicks 'Approve and Sign'.
YubiKey blinks. Architect touches the gold disc.
Signature is appended; pipeline transmits to CONAC SFTP automatically.
Confirmation appears: 'Dossier 2026-04-27-001 signed (GPG fingerprint XXXX) and delivered to CONAC. Polygon anchor pending.'
Within 30 seconds, the Polygon anchoring blink occurs. Architect touches again.
Final confirmation: 'Polygon anchor confirmed. Block 0xABCD... Tx 0xEF12...'


### 7.1  PIN Length And Composition
VIGIL APEX uses an 8-digit numeric PIN. 8 digits is the maximum supported by the PIV applet and provides 100 million possible values - against an 8-attempt lockout, this gives a brute-force success probability of 8 in 100,000,000 = 0.000008%. Adding alphabetic characters is technically possible on FIDO2 but not on PIV; uniformly using 8-digit numeric across all applets means one PIN to remember.
Choosing the PIN: pick 8 digits that are NOT (a) your birthday, (b) the architect's national ID number digits, (c) a phone number, (d) a sequence (12345678) or repeated digit (88888888). Use a mental method like the first digit of each word in a sentence only the architect knows: 'My architect mother born in seven six on twenty four nineteen' -> 7-6-24-19 padded -> '76241901'. Whatever method, the PIN is committed to memory and never written except in the sealed envelope deposited in the safe at provisioning.

### 7.2  Where The PIN Is Stored

### 7.3  Lockout Policy
PIV PIN lockout: 8 consecutive wrong attempts permanently locks the PIV applet. Once locked, the only path to recovery is the PUK; if the PUK has also been forgotten or its 3 attempts are exhausted, the PIV applet is dead and the YubiKey is bricked for PIV operations.
FIDO2 PIN lockout: 8 consecutive wrong attempts permanently destroys the FIDO2 credentials on the key. There is no PUK for FIDO2. Recovery is impossible; the key must be replaced and FIDO2 services re-enrolled to the replacement.
OATH (TOTP) does NOT have a PIN. Codes can be generated by anyone holding the key. This is intentional: TOTP codes are short-lived (30 seconds) and useless without the corresponding website credential, so the OATH applet does not warrant the lockout exposure of an additional PIN.


### 7.4  Changing The PIN
The PIN should be changed under any of these conditions: (a) suspected shoulder-surfing during entry, (b) compromise of the safe (necessitating revocation of the sealed paper backup of the PIN), (c) annual rotation as a hygiene practice (optional but recommended). Procedure:
Both keys must be changed in the same session. PIN diversity between the pair would defeat the interchangeability property.

### 7.5  PUK Management
The PIV PUK (PIN Unlock Key) is the recovery PIN used if the user PIN is locked out before the 8-attempt limit hits. Use it as follows:
The PUK has its own 3-attempt lockout. After 3 wrong PUK attempts, both PIN and PUK are permanently locked. The PUK is stored sealed in the safe alongside the PIN backup envelope; it is rarely needed, and procedure requires opening the safe (with a witness) to retrieve it.


### 8.1  Primary Key Lost In The Field
Scenario
The architect realises mid-day that the primary YubiKey is no longer on the keychain or lanyard. Last known good state: this morning at the desk. Possible locations: the office, a meeting room, a vehicle, a public space.
Immediate Response (within 1 hour)
Stop using all platform systems immediately. Do not log into any account.
Backtrack physically: every location visited since last confirmed possession. Most lost YubiKeys are recovered by retracing.
If not recovered within the first hour, treat as lost and proceed to escalation.
Escalation (within 24 hours)
Travel to the residence. Open the safe with witness present (Backup Architect or family member). Retrieve the backup YubiKey. Document safe access in the safe-access logbook.
Begin using the backup as the new daily primary. All systems work without re-enrolment because both keys were provisioned identically.
On every FIDO2-enrolled account, REVOKE the lost key's enrolment. (Most services list registered keys with serial numbers; identify the lost serial and remove its enrolment.) This denies a finder the ability to authenticate even if they somehow obtain a PIN.
Initiate procurement of a replacement YubiKey from Yubico authorised distributor. Lead time to Cameroon: 2-4 weeks.
Notify the Backup Architect of the lost-key state. The platform is now running on a single key until the replacement arrives.
Replacement Provisioning
Follow the full Section 05 provisioning procedure for the new key, treating it as the new backup. The current daily key (originally the backup) remains primary.
Once the new backup is in the safe and verification has passed, the pair is restored.

### 8.2  Primary Key Stolen Along With The Laptop
Scenario
The MSI Titan and the YubiKey were on a desk or in a bag, both taken. Possible adversary: petty thief, targeted adversary, intelligence service, organised crime.
Threat Assessment
If the adversary is a petty thief: the YubiKey is metal/plastic that requires a PIN. The thief tries 8 wrong PINs and the FIDO2 applet self-destructs. The thief has a brick. The Titan boots to BitLocker prompt and the thief cannot guess the PIN; after 8 wrong attempts, BitLocker enters recovery-key-only mode (key not retrievable from the YubiKey because the thief doesn't have the PIN). Net result: physical loss only, no data compromise.
If the adversary is targeted/state-level: they may attempt social engineering for the PIN, may attempt side-channel attacks on the YubiKey hardware (very expensive, requires specialist lab), may attempt to coerce the architect. Operational protection is to make compromise time-expensive: every minute the architect has to revoke credentials is a minute the adversary can't exploit.
Immediate Response (within 30 minutes)
File police report with detailed equipment description and serial numbers.
From a different computer (phone, internet cafe, trusted associate), revoke the architect's enrolment on EVERY service: Anthropic, AWS, Hetzner, Cloudflare, GitHub, Synology, M365, the SAS bank. Use account recovery codes from the safe to authenticate to each service for the revocation.
Synology DSM admin: physically travel to each NAS unit (primary and remote) and use the local-console reset to invalidate the stolen key's FIDO2 enrolment.
Hetzner: rotate the SSH host keys on the VPS. Even if the adversary somehow extracts the SSH credential from the YubiKey (essentially impossible without specialist hardware), the Hetzner VPS will reject the credential against the new host key.
Polygon wallet: monitor the wallet address on a Polygon explorer. The wallet seed phrase is split Shamir 3-of-5; the adversary holding only the YubiKey share has 1 of 5 shares and cannot reconstruct the seed alone. No defensive transaction needed unless 3 shares are suspected compromised.
Within 24 Hours
Retrieve backup YubiKey from safe.
Re-enrol backup YubiKey on every service that was revoked.
Initiate Titan replacement procurement and replacement YubiKey procurement.
Document the incident in a written report to the commissioning body within 48 hours, with current status of every credential.

### 8.3  Key Damaged (Physical Failure)
Scenario
The primary YubiKey becomes unresponsive. Symptoms: not recognised when plugged in, intermittent connection, gold disc not registering touches, NFC not responding.
Diagnosis
Try a different USB-C port and a different USB-C cable. The cable is the most common failure point - YubiKeys themselves are extremely durable.
Plug into a different computer to rule out host-side driver issues.
Run 'ykman info' to check if the device is detectable at the lowest level. If yes but applets are misbehaving, the firmware may have wedged - rare. If no detection at all, the hardware is failed.
Response
If hardware failed: retrieve backup, designate as new primary, procure replacement, follow standard replacement provisioning.
If software / firmware wedged: try a power cycle (unplug for 30 seconds, replug). YubiKeys do not normally need this; if it fixes the issue, log the event. If the issue recurs, treat as hardware failed and replace.
Damaged keys are NEVER discarded intact (Section 10.3 destruction procedure).

### 8.4  PIN Forgotten
Scenario
The architect cannot recall the PIN. Possible cause: extended absence from operations (vacation, illness), stress, head injury.
Response
DO NOT try guesses - each wrong attempt counts toward the 8-attempt lockout.
Travel to residence. Open safe with documented witness. Retrieve sealed PIN envelope. Read PIN. Use it to unlock the YubiKey.
Re-seal the envelope (if intact and undisturbed) and re-deposit, OR change the PIN to a new memorisable value and deposit a new sealed envelope. Burn the old envelope, witnessed.

### 8.5  Both Keys Lost Simultaneously
Scenario
This is the worst-case operational failure: catastrophic event (house fire while travelling, both physical locations compromised in coordinated attack, etc.) takes BOTH keys out of the architect's control. By design, this is the only scenario for which the platform's recovery is genuinely difficult.
What Survives
Vault and Polygon wallet: 4 of 5 Shamir shares survive (architect's two YubiKey shares are gone, but the safe paper share, backup architect's share, and institutional partner's share remain). Threshold met. Vault and Polygon wallet remain recoverable.
BitLocker: recovery key in safe envelope - if the safe survived. If the safe also did not survive (e.g. house fire AND simultaneous YubiKey loss in field), Microsoft's M365 account recovery key copy is the second-line backup.
Synology DSM: physical reset at each NAS recovers admin access without YubiKey. The remote NAS at a separate physical site is the survivable copy of the data itself.
OpenPGP signing key: this is the only credential with NO recovery path by design. The OpenPGP key is permanently lost. A new OpenPGP key must be generated, published, and re-distributed to CONAC.
Response (multi-day procedure)
Day 1: Activate Backup Architect. Establish a secure location for emergency operations (Backup Architect's location with their share).
Day 1-2: Procure two new YubiKeys via expedited shipping. Pay express premium.
Day 2-5: Reconstruct Vault unseal from 3 surviving shares. Reconstruct Polygon wallet seed from 3 surviving shares.
Day 3-7: Once new YubiKeys arrive, follow full Section 05 provisioning. Generate a NEW OpenPGP key (the old one is gone). Publish the new public key. Notify CONAC of the key rotation with formal letter signed by the Technical Director.
Day 7-10: Re-enrol on every FIDO2 service. Re-enrol every TOTP secret using account recovery codes.
Throughout: written incident report to commissioning body every 48 hours. Public dossier-signing-key rotation log entry on Hyperledger ledger.


### 9.1  Custody Roles

### 9.2  Safe Access Policy
The safe at the residence is accessed under the following conditions:
Routine: weekly verification (Section 06.4) - architect alone, logged in safe-access logbook.
Routine: monthly content audit - architect alone, verifies every sealed envelope is intact, logbook entry.
Annual: full rotation drill (Section 13) - architect plus witness (Backup Architect or institutional partner), logbook entry, photo of safe contents at start and end.
Emergency (PIN forgotten, primary key lost, key stolen): architect plus available witness, logbook entry detailing the trigger event.
Backup Architect emergency activation: Backup Architect plus institutional witness, opens safe to retrieve backup YubiKey and PIN envelope, full logbook entry, photo documentation, immediate notification to commissioning body.

### 9.3  The Safe Access Logbook
A bound paper logbook (not loose-leaf, not digital) is kept inside the safe. Every safe opening creates an entry. The logbook is the audit trail of physical access to the platform's break-glass material.

### 9.4  No-Access List
The following parties have NO access, under any conditions, to the YubiKey pair, the PIN, the safe, or any platform credential:
Other CONAC staff (excluding the named institutional partner specifically authorised in the SOW confidential annex).
MINFI staff.
World Bank, IMF, EU, UNDP, AfDB partner staff.
VIGIL APEX SAS shareholders or board members other than the Technical Director and Backup Architect.
Family members or domestic staff of the Technical Director.
Any law enforcement officer absent a duly served legal warrant - in which case the legal counsel on retainer (Section 09 of the MVP proposal) is engaged immediately and proper compliance procedures followed.



### 10.1  Procurement
Replacement YubiKeys are purchased through Yubico's authorised distributor channel. NEVER purchase through general electronics retailers, marketplace listings (Amazon third-party, Jumia third-party), or unverified resellers - counterfeit YubiKeys exist and a counterfeit will pass surface inspection but will leak credentials in ways that defeat the entire security model.

### 10.2  Replacement Provisioning
Provisioning a new YubiKey when ONE of the existing pair is being replaced (the other is intact) is slightly different from the M0 full provisioning because the OpenPGP key already exists and must be transferred onto the new key. Procedure:
Verify the surviving original key is functional. Test FIDO2, PIV, OpenPGP signing, OATH code generation, Polygon signing.
Connect the new (replacement) YubiKey alongside the surviving original. Set the same PIN, PUK, Management Key on the new key.
Disable Yubico OTP and Static Password applets on the new key (per Section 5.3).
OpenPGP transfer: use 'gpg --card-edit' on the surviving key to extract the encrypted secret subkey blob (this is a controlled export; the master signing key NEVER leaves either YubiKey). Insert new key. 'gpg --card-edit' -> 'admin' -> 'keytocard' to write the same subkeys onto the new key.
FIDO2 re-enrolment: on every FIDO2-protected service, add the new YubiKey as an additional credential. The surviving original remains enrolled until verification passes.
PIV slot 9C (Polygon wallet): generate the wallet seed share on the new key matching the existing share scheme.
OATH (TOTP): for every TOTP-enrolled account, copy the secret onto the new key. (Yubico Authenticator supports this directly.)
Verification battery (per Section 5.11): every test must pass on the new key before declaring it provisioned.
Update the provisioning attestation document with the new key's serial number and the date.

### 10.3  Old Key Destruction
A YubiKey being decommissioned (lost, damaged, replaced for hygiene) must be destroyed unless it is the lost key (which is by definition not in our possession). Destruction procedure:
First: invalidate the key's credentials. Run 'ykman piv reset', 'ykman fido reset', 'ykman oath reset', 'gpg --card-edit' -> 'factory-reset'. This wipes the on-card data.
Second: remove the key's enrolment from every FIDO2 service it was registered with. Confirm via the service's security settings that the serial is gone.
Third: physical destruction. Use a hammer to smash the USB-C connector. Use wire cutters to sever the gold contact disc. Use a metal saw or shears to cut the body in half. Place fragments in two separate trash receptacles to ensure no party can reassemble. Witnessed by Backup Architect or institutional witness.
Fourth: log the destruction. Date, time, key serial, witness, signed.

### 10.4  Annual Rotation Policy
YubiKeys do NOT need annual cryptographic rotation - the keys themselves are not weakened by age. However, an annual hygiene rotation provides:
Verification that the replacement procedure works (institutional drill value).
Refresh of the safe contents (replacing PIN envelope, recovery key envelope) on a known schedule.
Opportunity to update firmware (by replacing with newer firmware version) - the only path to firmware update.
Test of the destruction procedure under controlled conditions.
VIGIL APEX policy: optional annual rotation, mandatory at any of these triggers - (a) firmware vulnerability disclosed by Yubico that affects the deployed version, (b) suspected compromise of the PIN, (c) personnel change in the architect role, (d) major Synology DSM, BitLocker, or Vault upgrade that changes the credential format.


### 11.1  Audit Sources
YubiKey usage produces audit trails in four distinct places:

### 11.2  Retention

### 11.3  Audit Access
Routine audit review by the Technical Director: monthly examination of Vault audit log, GPG signing log, and Polygon transaction history for anomalies (operations during sleeping hours, unusual rapid sequences, signatures from a key that should not currently be in use, etc.). Anomalies trigger immediate investigation.
Independent audit: the named institutional partner OR an external auditor designated by the commissioning body may request audit access at any time. The architect provides read-only access to the relevant logs within 48 hours of request. Audit access does NOT include the ability to use the YubiKeys, only to view their usage records.


### 12.1  Protected Against

### 12.2  NOT Protected Against (Residual Risks)


### 13.1  Weekly - Backup Key Health Check
Every Sunday evening (or first available evening), the architect retrieves the backup YubiKey from the safe, performs a brief verification, and returns it. Steps:
Open safe (logbook entry).
Plug backup key into the Titan (NOT replacing the primary - just for the verification, primary stays plugged in too).
Run 'ykman info' to confirm device responds and firmware reads correctly.
Trigger a test FIDO2 login on a non-critical service (e.g. a personal GitHub account or a Yubico demo page) - touch the backup key. Confirm successful auth.
Sign a test text file with GPG using the backup key. Confirm signature verifies.
Compute a TOTP code for one enrolled service and compare with the primary key's code for the same window - codes should match exactly (because both keys hold the same secret and the time is the same).
Unplug. Return to safe. Logbook entry: 'Backup key verified, all tests pass.'

### 13.2  Quarterly - Full Failover Drill
Once per quarter, the architect simulates losing the primary key. For one full working day, the primary is sealed in an envelope at the desk and ONLY the backup is used. The architect's normal duties are performed: log into Synology, review dossiers, sign a test dossier, read Vault secrets. At the end of the day:
Confirm every duty was completed normally with the backup acting as primary.
Note any service that failed or required intervention - this is a configuration gap that must be fixed (the backup should have been pre-enrolled to that service).
Restore the original primary as primary, return backup to safe.
File quarterly drill report to the commissioning body (or hold for audit on request).

### 13.3  Annual - Full Rotation And Recovery Drill
Once per year, on a planned date with the Backup Architect and an institutional witness present, perform a full rotation drill simulating the most stressful operational scenario:
Begin with both YubiKeys present and a pair of NEW (unprovisioned) YubiKeys ready.
Power off all running platform components in a controlled shutdown.
Simulate 'both keys lost' by sealing both YubiKeys in an envelope held by the institutional witness for the duration of the drill.
Open the safe. Retrieve paper Shamir shares. Retrieve the institutional partner's share (the partner attends the drill or has provided their share securely in advance).
Reconstruct the Vault unseal seed from 3 paper shares. Reconstruct the Polygon wallet seed from 3 paper shares.
Provision the two NEW YubiKeys following the full Section 5 procedure.
Re-deploy Vault unsealing using the new YubiKeys + new Shamir shares.
Re-deploy Polygon wallet using the new YubiKeys + new Shamir shares.
Generate a NEW OpenPGP key (simulating the loss of the old). Distribute the new public key. Sign a test dossier with the new key.
Confirm every system is operational with the NEW key pair.
Restore the original keys (released by the institutional witness). Securely destroy the new test pair (Section 10.3) - they were a drill, not the production keys. OR adopt the new keys as the next-cycle primary pair if the rotation is desired.
File annual drill report to the commissioning body. Include time-to-recovery metrics.

### 13.4  Drill Pass Criteria


Appendix A - Quick Reference Card (laminate this page)

Appendix B - PIN Composition Rules
8 digits.
Not your birthday, ID number, phone number, or any number you have in any document.
Not a sequence (12345678) or repeated digit (88888888).
Memorisable via a personal mnemonic only you know.
Sealed paper backup in the safe; nowhere else.
Same PIN on both keys of the pair.
Changed only per Section 7.4 procedure.

Appendix C - Initial Provisioning Checklist

Appendix D - Failure Response Decision Tree

Appendix E - Vendor & Reference Information

—  END OF MANUAL  —

VIGIL APEX  -  Hardware Security Key Operations Manual  -  v1.0  -  April 2026
RESTRICTED  -  HOLD AT THE LEVEL OF THE COMMISSIONING BODY
(c) 2026 Junior Thuram Nana - VIGIL APEX SAS - All Rights Reserved

### Table 0

| Field | Value |
|---|---|
| Document Type | Operational Procedures Manual - Hardware Security |
| Classification | RESTRICTED - VIGIL APEX SAS / CONAC - Republic of Cameroon |
| Version | 1.0  -  April 2026 |
| Prepared By | Junior Thuram Nana - Technical Director & Platform Architect |
| Scope | Provisioning, daily operation, custody, failure response, and audit of the YubiKey 5C NFC hardware security key pair that controls all sensitive operations on VIGIL APEX |
| Audience | Technical Director (primary user); Backup Architect (emergency-only); Independent Security Auditor; CONAC technical reviewer |
| Related Documents | CORE_SRD (Security Requirements Document), CORE_MVP (Investment Proposal Section 02), CORE_BUILD_COMPANION (Implementation Reference) |
| Review Cycle | Annually, or on any material change to the underlying systems (DSM upgrade, Vault upgrade, BitLocker policy change) |

### Table 1

| 01 | PURPOSE & SCOPE What this manual is for, who reads it, and what it does NOT cover |
|---|---|

### Table 2

| Topic | Where in this manual |
|---|---|
| The hardware itself - what a YubiKey 5C NFC is and what it can do | Section 02 |
| Why two keys (the pair model) and how they relate to each other | Section 03 |
| Every system the keys unlock, with technical mechanism | Section 04 |
| Initial provisioning procedure at M0 (mobilisation) | Section 05 |
| Day-to-day operational flow | Section 06 |
| PIN management policy and procedures | Section 07 |
| All failure modes with corresponding response procedures | Section 08 |
| Custody policy and authorised access | Section 09 |
| Replacement, rotation, and decommissioning | Section 10 |
| Audit trail requirements and review | Section 11 |
| Threat model - what the keys do and do not protect against | Section 12 |
| Periodic testing and drills | Section 13 |
| Reference appendices (cards, checklists, decision trees) | Section 14 |

### Table 3

| OPERATING ASSUMPTION This manual assumes the reader has at least once held a YubiKey, plugged one into a USB port, and tapped the gold disc to authorise an action. It is written for an operator, not for a beginner who has never seen the hardware. If you have never used a YubiKey before, spend 30 minutes with the official Yubico Quick Start Guide before reading further. Coming back to this manual after that initial familiarity will make every procedure here noticeably faster to internalise. |
|---|

### Table 4

| 02 | THE HARDWARE - YubiKey 5C NFC Physical description, internal capabilities, and lifecycle |
|---|---|

### Table 5

| Applet / Capability | What It Does | VIGIL APEX Use |
|---|---|---|
| FIDO2 / WebAuthn | Stores resident credentials (passwordless login keys) and performs challenge-response with web services. PIN-protected. Tamper-resistant. | Synology DSM admin login. Could replace passwords for any FIDO2-supporting service. Locks out after 8 wrong PINs. |
| PIV (Personal Identity Verification - smartcard) | Stores up to 24 X.509 certificates and matching private keys. Acts as a physical smartcard. | Windows Smart Card login. SSH client certificate auth via PKCS#11. PIV-based EV code signing. |
| OpenPGP | Generates an OpenPGP keypair entirely on-card; the private key never exists on disk. Performs signing and decryption requests using that key. | Signing every dossier PDF before SFTP transfer to CONAC. Decrypting any encrypted documents sent to the architect. |
| OATH-TOTP / OATH-HOTP | Stores up to 32 TOTP secrets. Computes 6-digit codes on demand without revealing the underlying secret. | Two-factor authentication for Anthropic, AWS, Hetzner, Cloudflare, GitHub, M365, the SAS bank account, and every other web account that supports TOTP. |
| Static Password / Yubico OTP | Outputs a long static or one-time password by emulating a USB keyboard. | Not used by VIGIL APEX. Disabled at provisioning to reduce attack surface. |
| Challenge-Response (HMAC-SHA1) | Computes HMAC of an arbitrary 64-byte challenge using a slot-stored secret. | HashiCorp Vault unseal contribution. Disk-encryption pre-boot challenge for LUKS2 (if Linux ever added). |

### Table 6

| Mode | When to use it |
|---|---|
| USB-C (wired) | Default for desktop and laptop work. Plug into the MSI Titan, the Synology web admin computer, or any USB-C port. Stays plugged in during a working session and is removed when you leave the desk. |
| NFC (wireless tap) | For mobile authentication. Tap the back of an Android phone or iPhone (iOS 13+) to authorise an action initiated on the phone. Useful for approving a 2FA prompt on the phone without searching for a USB-C cable. Range is approximately 1-3 cm; this is a security feature, not a limitation. |

### Table 7

| Aspect | Detail |
|---|---|
| Operational lifespan | Yubico rates the hardware for 'operational lifetime' - typically 10+ years of regular use. There is no battery to wear out and no mechanical contact that degrades quickly. The metal contact disc and the USB-C connector are the most-touched components. |
| Firmware updates | NONE. Firmware is fixed at manufacture. To upgrade firmware, replace the key. |
| Counters / wear indicators | Each PIV slot has a usage counter visible via ykman piv info. There is no hard cap, but counters are useful audit data. |
| End-of-life | Replace any key showing physical damage, intermittent recognition, or PIN reset failure. Old keys must be securely destroyed (Section 10) - never thrown intact in trash, never resold. |
| Warranty | Yubico provides a 1-year hardware warranty. For VIGIL APEX, warranty is largely irrelevant: a defective key is replaced and provisioned anew, regardless of whether Yubico reimburses the original cost. |

### Table 8

| 03 | THE PAIR Why two keys, and how they relate |
|---|---|

### Table 9

| Property | How achieved |
|---|---|
| Identical authentication credentials | Both keys are enrolled separately to every FIDO2 service, both keys hold the same OpenPGP key material (generated on one and securely transferred to the other - or generated identically by following the same procedure on both), both keys store the same TOTP secrets. |
| Identical PIN | Set to the same 8-digit value on both keys at provisioning. Memorised, never written. The Technical Director must remember a single PIN, not two. |
| Identical capabilities enabled / disabled | Both keys have the same applets enabled (FIDO2, PIV, OpenPGP, OATH) and the same applets disabled (Yubico OTP, static password). Configuration parity prevents one key from working in a flow the other cannot. |
| Functional interchangeability | Either key can fully replace the other, immediately, at any time. There is no 'primary-only' operation. |

### Table 10

| Key | Custody and physical location |
|---|---|
| PRIMARY | On the person of the Technical Director at all times during operational hours. Carried on a sturdy keychain, lanyard, or in a dedicated pocket. Treated like a house key - it goes where the architect goes. Never left in the laptop overnight, never left on a desk in a shared space, never lent out. |
| BACKUP | Stored in the SentrySafe SFW123GDC fireproof safe at the Technical Director's residence. The safe is bolted to the floor or weighs >=30 kg to defeat carry-out theft. The safe holds the backup YubiKey, a paper envelope with the BitLocker recovery key and LUKS2 master passphrase (sealed and signed across the seal), and nothing else operationally relevant. |

### Table 11

| SEPARATION DISCIPLINE The primary and backup are NEVER in the same physical location at the same time, except during the few minutes of provisioning at M0 and during the few minutes of any annual rotation drill (Section 13). If the architect is travelling for a multi-day institutional event, the primary travels; the backup stays in the safe at home. The whole point of the pair is geographic separation, identical to the NAS pair: a single physical event that takes the primary out (theft, fire, seizure) must not also take the backup. |
|---|

### Table 12

| 04 | WHAT THE KEYS UNLOCK Each of the seven systems, with technical mechanism and consequence-of-loss |
|---|---|

### Table 13

| THE PATTERN Six of the seven systems above have an operational break-glass that does NOT route through the YubiKey - either because the underlying system provides one (BitLocker recovery, DSM physical reset, Hetzner web console, TOTP recovery codes) or because the architecture deliberately splits the secret (Vault Shamir 3-of-5, Polygon Shamir 3-of-5). Only the GPG signing key has no break-glass: the on-card private key is unrecoverable by design. This is the price of provable physical signature - and the reason the YubiKey pair is provisioned to BOTH hold the same OpenPGP key, so the loss of one does not lose the key. |
|---|

### Table 14

| 05 | PROVISIONING PROCEDURE (M0) End-to-end setup of the YubiKey pair at mobilisation |
|---|---|

### Table 15

| ykman config usb -d OTP -d HOTP -f ykman config nfc -d OTP -d HOTP -f |
|---|

### Table 16

| # YubiKey #1 ykman piv access change-pin --new-pin <CHOSEN_PIN> ykman piv access change-puk --new-puk <CHOSEN_PUK> ykman piv access change-management-key --new-management-key <RANDOM_24_HEX> --algorithm AES256   # Repeat identical commands on YubiKey #2 with same PIN, same PUK, same Mgmt Key. |
|---|

### Table 17

| # YubiKey #1: generate OpenPGP master keypair on-card gpg --card-edit admin key-attr   # choose RSA 4096 or ed25519/cv25519 - VIGIL APEX standard: ed25519 sign + cv25519 encrypt generate # Answer prompts: name "Junior Thuram Nana", email "architect@vigilapex.cm", # expiry 5 years, no backup of master key (declined) quit   # Record fingerprint: gpg --list-keys --fingerprint architect@vigilapex.cm # Print fingerprint on paper, sign across the print, deposit in safe.   # Transfer to YubiKey #2: # Insert YubiKey #2. Run 'gpg --card-edit' and use 'admin' + 'fetch' # to import the matching public key. Then use 'keytocard' to write # the same secret subkeys into YubiKey #2's OpenPGP slots. # (Detailed sub-procedure in Appendix C.) |
|---|

### Table 18

| Test | Pass condition |
|---|---|
| BitLocker boot | Titan boots successfully when only Key #1 is present (Key #2 in safe). Repeat with only Key #2. |
| DSM admin login (primary NAS) | Both keys can complete admin FIDO2 login independently. |
| DSM admin login (remote NAS) | Both keys can complete admin FIDO2 login independently. |
| SSH to Hetzner | Both keys can complete an SSH session and run 'whoami' as root. |
| GPG signing | Each key can produce a valid OpenPGP signature on a test file. Both signatures verify against a single public key. |
| TOTP code generation | For three randomly chosen enrolled services, both keys produce identical 6-digit codes for the current 30-second window. |
| Polygon test transaction | Each key independently signs and broadcasts a 0-value Polygon test transaction to the architect's own address. Both transactions confirm on-chain. |
| Vault test unseal | A simulated Vault restart can be unsealed using each key independently (with paper shares). |

### Table 19

| 06 | DAY-TO-DAY OPERATIONS What the architect does with the keys, every day |
|---|---|

### Table 20

| # | Action |
|---|---|
| 1 | Sit down at the MSI Titan. Place coffee out of splash range of the laptop. |
| 2 | Open the desk drawer or remove from keychain. Take the primary YubiKey. |
| 3 | Plug the primary YubiKey into the Titan's USB-C port. |
| 4 | Power on the Titan. BitLocker pre-boot screen appears. |
| 5 | Type the PIV PIN. Touch the gold disc when it blinks. BitLocker unlocks. Windows boots. |
| 6 | Sign in to Windows with your account password. The YubiKey is recognised as a smart card. |
| 7 | Once at the desktop, ssh-agent is running and has loaded the YubiKey-backed SSH credential. Verify with 'ssh-add -L' - you should see your public key fingerprint. |
| 8 | Open Synology DSM in browser. Log in with username + password + FIDO2 (touch). Confirm both NAS units are healthy and Snapshot Replication is current. Log out of DSM (do not leave admin session idle). |
| 9 | The YubiKey stays plugged in for the working session. NFC interface remains available for phone-side authentications. |

### Table 21

| # | Action |
|---|---|
| 1 | Close all open browser sessions on Synology, AWS, Anthropic, etc. (Sessions otherwise persist with cached credentials.) |
| 2 | Run 'ssh-add -D' to clear the SSH agent's cached credentials. (The YubiKey remains the credential source; this just forces re-touch on the next SSH session.) |
| 3 | Hibernate or power off the Titan. (Powering off forces BitLocker re-unlock at next boot - more secure than hibernate.) |
| 4 | Unplug the primary YubiKey. Place it on the keychain or lanyard. Carry it home. |
| 5 | If the day is the weekly backup-verification day (typically Sunday), open the safe, retrieve the backup YubiKey, run a brief verification (test FIDO2 login to one service, confirm OpenPGP signing on a test file), then return the backup to the safe. Log the verification on the keys-status logbook. |

### Table 22

| 07 | PIN MANAGEMENT Choosing, holding, changing, and recovering the PIN |
|---|---|

### Table 23

| Location | Form |
|---|---|
| The architect's memory | Primary location. The architect can recite the PIN cold, with no reference. |
| Sealed envelope in safe | Backup. Sealed at provisioning, signed across the seal. Opened only in a documented break-glass scenario (e.g. Backup Architect emergency activation). |
| NOWHERE ELSE | The PIN is NOT in a password manager. The PIN is NOT in a notes app. The PIN is NOT written on a sticky note. The PIN is NOT shared with any human verbally except the Backup Architect at the formal handover ceremony documented in the SOW confidential annex. |

### Table 24

| LOCKOUT IS A FEATURE, NOT A BUG An attacker who steals the YubiKey but does not know the PIN gets eight chances to guess. Eight failures destroys the relevant applet's credentials. With 8 digits and 8 attempts, the attacker has approximately a 1-in-12-million chance of guessing correctly. Combined with the requirement that the attacker also possess the matching account password (for FIDO2) or the matching encrypted volume (for PIV/BitLocker), the practical attack difficulty is overwhelming. The architect's risk under the lockout policy is forgetting their own PIN - which is mitigated by the safe envelope and by daily use that keeps the PIN in active memory. |
|---|

### Table 25

| # Connect both YubiKeys in sequence. # For each key: ykman piv access change-pin --pin <OLD_PIN> --new-pin <NEW_PIN>   # For FIDO2: # (Use Yubico Authenticator GUI or:) ykman fido access change-pin --pin <OLD_PIN> --new-pin <NEW_PIN>   # Update the sealed PIN envelope in the safe with the new PIN. # Burn the old envelope (witnessed by Backup Architect or institutional witness). |
|---|

### Table 26

| # After 1-7 wrong PIN attempts, before the 8th attempt: ykman piv access unblock-pin --puk <PUK> --new-pin <NEW_PIN_OR_SAME> |
|---|

### Table 27

| 08 | FAILURE MODES & RESPONSE Every realistic failure scenario, with documented response procedure |
|---|---|

### Table 28

| 09 | CUSTODY & ACCESS POLICY Who holds what, who can access what, and under what authority |
|---|---|

### Table 29

| Role | Holds | Authority |
|---|---|---|
| Technical Director | Primary YubiKey on person; PIV PIN in memory; routine access to safe | Sole holder of all daily-operations credentials. Can authorise any platform action. |
| Backup Architect | 1 Vault Shamir share (paper); 1 Polygon Shamir share (paper); access to safe in emergency only; combination/key to safe held in their own separate secure location | Read access to platform documentation. Activates as platform operator if Technical Director is incapacitated. Cannot unilaterally exercise platform credentials (alone, only 2 of 5 Shamir shares are theirs and the safe's). |
| Institutional Partner (CONAC senior security officer or designate) | 1 Vault Shamir share (paper); 1 Polygon Shamir share (paper) | Provides the third Shamir share required for break-glass. Cannot exercise the platform alone (1 share). Has no operational role under normal conditions. |
| Safe (residence) | Backup YubiKey; sealed PIN envelope; sealed PUK envelope; sealed BitLocker recovery key; 1 Vault Shamir share (paper); 1 Polygon Shamir share (paper); provisioning attestation | Inert hardware repository. Activated only by documented procedure. |
| Commissioning Body Technical Reviewer | Read access to this manual. May witness drills (Section 13). Holds NO credentials. | Audit and oversight role only. Does NOT hold any operational secret. |

### Table 30

| Field | What is recorded |
|---|---|
| Date and time | Day, hour, minute of safe opening. |
| Operator | Name and capacity of person opening the safe. |
| Witness (if required) | Name and capacity of any required witness. |
| Trigger | Reason: routine weekly check, routine monthly audit, annual drill, emergency (specify type). |
| Items removed | Each item taken out, even if returned in the same session. |
| Items returned | Each item placed back. End-state must match start-state (or be a documented change). |
| Items consumed / replaced | If a sealed envelope is opened and replaced, both events recorded. |
| Closing time | When the safe is locked again. |
| Operator signature | Wet-ink signature confirming the entry. |
| Witness signature | Wet-ink signature of the witness, if any. |

### Table 31

| WHY THIS MATTERS The YubiKey pair is, in the cryptographic sense, the architect's signature. Letting any other party hold one - even for convenience, even briefly - would mean the platform can no longer prove that any given dossier was authorised by the architect personally. The single-architect AI-augmented model derives its institutional credibility from the auditable chain: 'this dossier was signed with a key in the physical possession of one named human'. Diluting that chain is not an operational shortcut; it is the destruction of the platform's evidentiary value. |
|---|

### Table 32

| 10 | REPLACEMENT, ROTATION & DECOMMISSIONING How to add a new key and how to retire an old one |
|---|---|

### Table 33

| Aspect | Detail |
|---|---|
| Authorised channel | Yubico direct (yubico.com) - ships internationally including to Cameroon. Or a regional authorised reseller documented at https://www.yubico.com/store/where-to-buy/. |
| Lead time to Cameroon | Direct from Yubico: typically 2-3 weeks via DHL. Express shipping reduces to 7-10 days at additional cost. |
| Quantity per order | Always order pairs (2 keys) for VIGIL APEX, even if replacing only one - having a third unprovisioned key in inventory shortens the next replacement cycle. |
| Verification on arrival | Holographic seal intact, blister pack unopened, serial number matches the shipping invoice. Yubico provides an attestation API at https://api.yubico.com/wsapi/2.0/verify which confirms a key's authenticity by serial - use it for any post-2026 procurement to detect counterfeits. |

### Table 34

| 11 | AUDIT TRAIL What gets logged about key usage, where, and for how long |
|---|---|

### Table 35

| Source | What is recorded |
|---|---|
| Service-side (each protected service) | Every successful FIDO2 authentication, every TOTP code consumed, every SSH session opened. The service records the user identity, IP, timestamp, and YubiKey serial that was presented. |
| Vault audit log | Every unseal operation, every secret read, every policy change. Vault's audit log is itself an append-only log; tampering is detectable. Stored on the primary Synology NAS in WORM volume. |
| GPG signing log | Every dossier signed produces a log entry: dossier ID, GPG fingerprint, timestamp, dossier SHA-256. Stored locally on Titan and replicated to Synology NAS. |
| Polygon ledger | Every blockchain anchor transaction is permanently and publicly recorded on Polygon mainnet. The transaction is signed by the architect's wallet (which exists only inside the YubiKey pair). Public, immutable, eternally verifiable. |

### Table 36

| Audit type | Retention |
|---|---|
| Vault audit log | Permanent, on WORM volume. Replicated to remote NAS. Cannot be deleted by any party including root. |
| GPG signing log | Permanent, replicated. SHA-256 of each entry anchored to Polygon weekly. |
| Service-side logs (Anthropic, AWS, Hetzner, etc.) | As provided by the service - typically 90 days to 1 year. The architect downloads quarterly snapshots and stores them in the dossier-archive WORM volume for permanent retention. |
| Polygon ledger | Permanent. Cannot be deleted. Block reorganisation depth on Polygon makes any anchor older than 1 hour effectively final. |
| Safe access logbook | Permanent paper record. Photographs of completed pages stored in WORM volume monthly. |

### Table 37

| 12 | THREAT MODEL What the YubiKey pair protects against and what it does not |
|---|---|

### Table 38

| Threat | How protected |
|---|---|
| Remote credential theft (phishing, malware on host, network MITM) | FIDO2 / U2F / PIV credentials cannot be exfiltrated by software; they exist only inside the YubiKey. SSH keys never touch disk. |
| Password database breach (Anthropic / AWS / Hetzner / etc. compromised) | FIDO2 enrollment provides phishing-resistant second factor. Even if the service's password database leaks, an attacker without the physical YubiKey cannot complete login. |
| Casual physical theft of the laptop | BitLocker + YubiKey-PIN gates the drive. Without YubiKey + PIN, the drive is unreadable. After 8 wrong PINs, the YubiKey FIDO2 + PIV applet self-destructs. |
| Casual physical theft of a single YubiKey | Without the PIN, 8 wrong attempts brick the FIDO2 / PIV applets. With the PIN, the attacker also needs the corresponding service password. PIN is not on the key, not on the laptop, not in any digital location. |
| Administrator credential abuse on the host computer | Even root / Administrator on the laptop cannot extract the keys. Cryptographic operations require physical touch on the YubiKey gold disc - software cannot fake this. |
| Insider threat from CONAC, MINFI, or partner staff | No insider holds a YubiKey. The institutional Shamir share alone (1 of 5) cannot be exercised. The architect's signature is required for any platform action. |
| Compromise of any single Shamir share holder (architect's safe, backup architect, institutional partner) | 3-of-5 threshold means no single share-holder can unilaterally exercise Vault unseal or Polygon wallet. Two simultaneous compromises also remain insufficient. |

### Table 39

| Threat | Why not protected / compensating control |
|---|---|
| Coercion of the architect to use the YubiKey under duress | No technology defeats a held-at-gunpoint scenario. Compensating control: the GPG signing key produces a signature recorded on Hyperledger immediately - any forced signing creates an unfalsifiable record. The 5-pillar council quorum (CONAC, ANIF, Bar, etc.) provides downstream validation that catches coerced findings. |
| Side-channel hardware attack on a captured YubiKey by a state-level adversary | Yubico documents the FIPS 140-2 / Common Criteria EAL5+ certification of the underlying secure element, but a sufficiently resourced adversary may eventually defeat any hardware. Compensating control: rapid revocation upon detection of theft, Shamir splits that require 3 separate physical compromises. |
| Architect coerced or social-engineered into changing the PIN to a value known to attacker | Behavioural / training control: the architect understands that any PIN change must follow Section 7.4 with witness, and that a PIN change request from any other party is a red flag warranting investigation, not compliance. |
| Counterfeit YubiKey supplied at procurement | Compensating control: Section 10.1 procurement only via Yubico authorised channel, Yubico attestation API verification on arrival, holographic seal verification. |
| Loss of both keys plus safe simultaneously (catastrophic event) | Section 8.5. The OpenPGP signing key is unrecoverable - this is the ONLY operational scenario where the platform suffers permanent cryptographic loss. Mitigation: geographic separation of safe and architect. |
| The architect's own loyalty changes (unhappy departure, ideological shift) | The institutional partner Shamir share + backup architect Shamir share together can break-glass the platform without the architect's cooperation. The 5-pillar council can publish formally that the architect is no longer authorised, after which any signature with the OpenPGP key is institutionally repudiated. |

### Table 40

| 13 | TESTING & DRILLS Periodic verification that the system still works |
|---|---|

### Table 41

| Drill | Pass criteria |
|---|---|
| Weekly health check | All Section 13.1 tests pass. Total drill time under 10 minutes. |
| Quarterly failover drill | Full working day completed using backup-only with NO unplanned escalations. Total drill time: 1 working day. |
| Annual full rotation drill | Platform fully restored to operational state with new key pair within 8 working hours. No data loss. No credential exposure to non-authorised parties. Documented in drill report. |

### Table 42

| 14 | APPENDICES Reference cards, checklists, decision trees |
|---|---|

### Table 43

| Situation | Action |
|---|---|
| YubiKey blinks unexpectedly (no action started by you) | DO NOT TOUCH. Investigate. Possible malware on host. |
| YubiKey blinks for an action you started | Touch the gold disc. ~0.5 seconds. |
| Service prompts for PIN | Type the 8-digit PIN. NEVER type it in front of a camera or shoulder-surfer. |
| Cannot remember PIN | Stop. DO NOT GUESS. Travel to safe. |
| Lost primary key | Backup key from safe. Revoke lost key. Procure replacement. Section 8.1. |
| Stolen key | Section 8.2 - immediate revocation on every service from a separate computer. |
| End of day | Unplug. Take with you. Log out of admin sessions. |
| Travelling | Primary on person, backup in safe. Always. |
| Anyone asks for your YubiKey | Refuse. Section 9.4. Notify commissioning body in writing. |
| Anyone asks for your PIN | Refuse. Notify commissioning body in writing. |
| Yubico attestation API at api.yubico.com | Use to verify any new YubiKey serial on procurement. |

### Table 44

| # | Step (check off when complete) |
|---|---|
| [ ] | Two new sealed YubiKey 5C NFC units in hand. Holographic seals intact. |
| [ ] | Provisioning environment: private room, no shoulder-surfers, phones face-down. |
| [ ] | Software installed: ykman, Yubico Authenticator, GnuPG 2.4+, OpenSSH+PKCS#11, scdaemon. |
| [ ] | Step 1: Inspected both keys. Recorded firmware versions and serial numbers. |
| [ ] | Step 2: Disabled Yubico OTP and Static Password applets on both keys. |
| [ ] | Step 3: Set identical PIN, PUK, Management Key on both keys. PIN sealed in safe envelope. |
| [ ] | Step 4: Polygon wallet seed generated offline, split via Shamir 3-of-5, distributed to YubiKey OATH slots, safe paper, backup architect, institutional partner. |
| [ ] | Step 5: OpenPGP key generated on Key #1. Subkeys transferred to Key #2. Fingerprint recorded. |
| [ ] | Step 6: FIDO2 enrolled on every protected service for both keys. |
| [ ] | Step 7: TOTP secrets enrolled on both keys for every account. Recovery codes printed and sealed. |
| [ ] | Step 8: BitLocker configured with YubiKey + PIN on Titan. Recovery key sealed in safe. |
| [ ] | Step 9: Vault unseal Shamir distributed identically to Polygon (Section 5.10). |
| [ ] | Step 10: All 8 verification tests passed for each key independently. |
| [ ] | Step 11: Provisioning attestation document signed and deposited in safe. |
| [ ] | Backup key in safe. Primary on person. Pair operational. |

### Table 45

| START: Something is wrong with the YubiKey or its access   Q1: Is the key physically present?   YES -> go to Q2   NO  -> see "Lost or Stolen" path   Q2: Does the host computer recognise the key (ykman info works)?   YES -> go to Q3   NO  -> Try different USB-C port + cable. Then different host.          If still no detection: HARDWARE FAILED -> Section 8.3   Q3: Can you authenticate to ONE known service with this key?   YES -> The key is fine. The service or process is the problem. Investigate that.   NO  -> go to Q4   Q4: Did you enter the PIN correctly (you are SURE)?   YES -> The key may be partially failed. Try resetting one applet via PUK.          If reset fails: HARDWARE FAILED -> Section 8.3   NO  -> Stop entering. Travel to safe (Section 8.4).   LOST OR STOLEN PATH:   Stolen WITH laptop      -> Section 8.2 (full revocation)   Stolen alone            -> Section 8.2 (revocation, plus hardened watch)   Lost (location unknown) -> Section 8.1 (1-hour backtrack, then escalate)   If at any point BOTH keys are unavailable:   -> Section 8.5 (catastrophic, multi-day recovery) |
|---|

### Table 46

| Item | Reference |
|---|---|
| Yubico authorised purchase | https://www.yubico.com/store/  -  ships to Cameroon |
| Yubico authorised resellers (regional) | https://www.yubico.com/store/where-to-buy/ |
| Yubico attestation verification | https://api.yubico.com/wsapi/2.0/verify  (counterfeit detection) |
| YubiKey 5C NFC product page | https://www.yubico.com/product/yubikey-5c-nfc/ |
| Yubico Authenticator (TOTP companion app) | https://www.yubico.com/products/yubico-authenticator/ |
| YubiKey Manager CLI (ykman) docs | https://docs.yubico.com/software/yubikey/tools/ykman/ |
| YubiKey + GPG smartcard reference | https://github.com/drduh/YubiKey-Guide |
| YubiKey + BitLocker on Windows | Microsoft Docs: Smart Card Logon and BitLocker pre-boot authentication |
| Synology DSM FIDO2 setup | DSM 7.2 Help: Control Panel > User & Group > Advanced > Security key |
| HashiCorp Vault Shamir unseal | https://developer.hashicorp.com/vault/docs/concepts/seal |