# Block-E E.12 / C9 backup gap 1 — Vault raft-snapshot policy.
#
# Single-purpose: read access to `sys/storage/raft/snapshot` so the
# nightly archive (infra/host-bootstrap/10-vigil-backup.sh) can produce
# a canonical raft snapshot. NOTHING ELSE — this policy must NOT be
# extended to grant any other capability; the architect's quarterly
# rotation pass per docs/runbooks/backup.md verifies the policy's
# capability list against this file's content.
#
# Token attached to this policy:
#   - 90-day TTL (renewable, but rotated quarterly anyway by the
#     architect — never let renew be the security boundary)
#   - period: 90 days (so it can be renewed without re-creating)
#   - non-orphan (parented to the architect token at creation)
#   - exported as VAULT_BACKUP_TOKEN to the systemd EnvironmentFile
#     /etc/vigil/backup.env, mode 0600 owner root.
#
# Provisioning command (architect-side, one-shot per quarter):
#   vault policy write vigil-backup-snapshot \
#     infra/vault-policies/backup-snapshot.hcl
#   vault token create -policy=vigil-backup-snapshot \
#     -ttl=2160h -period=2160h \
#     -display-name="vigil-backup-snapshot-$(date -u +%Y-Q%q)"

path "sys/storage/raft/snapshot" {
  capabilities = ["read"]
}
