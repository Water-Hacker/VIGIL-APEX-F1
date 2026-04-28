# Fabric MSP material policy (Phase G5).
#
# worker-fabric-bridge and audit-verifier read identity files from
# `secret/vigil/fabric/<org>` — TLS root cert + client signing cert +
# client signing private key. Three paths so each rotates
# independently. The architect policy retains write access for the
# Phase-2-entry multi-org enrolment ceremony.

path "secret/data/vigil/fabric/org1/tls_root"     { capabilities = ["read"] }
path "secret/data/vigil/fabric/org1/client_cert"  { capabilities = ["read"] }
path "secret/data/vigil/fabric/org1/client_key"   { capabilities = ["read"] }

# Future-proof: when CONAC + Cour des Comptes peers join, additional
# read paths are added here in Phase 2 entry, NOT a separate policy.
# The bridge worker is single-org by construction; the verifier is the
# only cross-org reader.

path "auth/token/renew-self"  { capabilities = ["update"] }
path "auth/token/revoke-self" { capabilities = ["update"] }
