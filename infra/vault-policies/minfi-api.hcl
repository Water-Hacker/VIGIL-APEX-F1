# MINFI API policy — read the response-signing private key + MINFI's
# request-signing public key. No writes. mTLS material is in /run/secrets,
# not Vault, so it doesn't appear here.

path "secret/data/vigil/minfi-api"    { capabilities = ["read"] }
path "secret/data/vigil/postgres"     { capabilities = ["read"] }
path "secret/data/vigil/redis"        { capabilities = ["read"] }

path "auth/token/renew-self"  { capabilities = ["update"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
