# Architect policy — full read/write on secret/vigil/*, plus policy
# administration. Activated only with a YubiKey-touched Vault login per
# the bootstrap ceremony (HSK §05). Sessions are short-lived (1 h TTL).

path "secret/data/vigil/*"      { capabilities = ["create", "read", "update", "delete", "patch"] }
path "secret/metadata/vigil/*"  { capabilities = ["list", "read", "delete"] }

# Policy administration
path "sys/policies/acl/*"       { capabilities = ["create", "read", "update", "delete", "list"] }
path "sys/policies/acl"         { capabilities = ["list"] }

# AppRole administration (rotate worker / dashboard / minfi-api creds)
path "auth/approle/role/*"      { capabilities = ["create", "read", "update", "delete", "list"] }
path "auth/approle/role/+/secret-id" { capabilities = ["update"] }

# Token introspection on running tokens
path "auth/token/lookup-accessor" { capabilities = ["update"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }

# Audit log management — only architect can rotate file backends
path "sys/audit"                { capabilities = ["read", "list"] }
path "sys/audit/*"              { capabilities = ["create", "read", "update", "delete", "sudo"] }
