# Worker policy — read-only on the secret/vigil/* paths the workers need.
# Bound via AppRole; tokens are rotated by 06-vault-policies.sh and
# materialised under /run/vigil/secrets/vault_token_worker by 05-secret-
# materialisation.sh. No write paths — workers MUST NOT alter secrets.

path "secret/data/vigil/postgres"      { capabilities = ["read"] }
path "secret/data/vigil/redis"         { capabilities = ["read"] }
path "secret/data/vigil/neo4j"         { capabilities = ["read"] }
path "secret/data/vigil/anthropic"     { capabilities = ["read"] }
path "secret/data/vigil/sentinelhub"   { capabilities = ["read"] }
path "secret/data/vigil/conac-sftp"    { capabilities = ["read"] }
path "secret/data/vigil/tip-portal"    { capabilities = ["read"] }
path "secret/data/vigil/turnstile"     { capabilities = ["read"] }
path "secret/data/vigil/polygon-signer/public_address" {
  capabilities = ["read"]
}

# Token self-management (renew + revoke own token only)
path "auth/token/renew-self"  { capabilities = ["update"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
