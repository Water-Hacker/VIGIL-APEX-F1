# Dashboard policy — read-only on the secrets the Next.js app needs at
# runtime. The dashboard is multi-tenant role-wise (operator / council /
# auditor) but Vault-side it's a single token; per-route RBAC is enforced
# in the middleware (Phase C1).

path "secret/data/vigil/postgres"    { capabilities = ["read"] }
path "secret/data/vigil/redis"       { capabilities = ["read"] }
path "secret/data/vigil/keycloak"    { capabilities = ["read"] }
path "secret/data/vigil/turnstile"   { capabilities = ["read"] }

path "auth/token/renew-self"  { capabilities = ["update"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
