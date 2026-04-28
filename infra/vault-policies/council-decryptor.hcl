# Council decryptor policy — bound to a council member's WebAuthn-gated
# Vault login (FIDO2 plugin). Read-only on the council Shamir share path
# specific to that member; the share itself is also encrypted with their
# YubiKey (age-plugin-yubikey), so even Vault compromise still requires
# physical YubiKey touch to extract the plaintext share.
#
# Per SRD §28.4: 3 of 5 council members must complete this ceremony for
# the operator-team private key to be reconstructable, which then
# decrypts a sensitive tip via worker-tip-triage.

path "secret/data/vigil/council/shares/{{identity.entity.aliases.auth_userpass_*.name}}" {
  capabilities = ["read"]
}

path "auth/token/renew-self"  { capabilities = ["update"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
