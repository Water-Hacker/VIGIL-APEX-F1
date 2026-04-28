#!/usr/bin/env bash
# vigil-key-rotation — quarterly architect prompt + targeted rotation.
#
# Phase F10. Two modes:
#   prompt           — fired by the systemd timer; sends an email +
#                      AlertManager warning; the architect runs the
#                      specific rotation commands manually after a
#                      ceremony (HSK-v1 §07).
#   <subsystem> ...  — perform an actual rotation. Subsystems:
#                        vault-tokens   re-mint AppRole tokens (B6)
#                        polygon-wallet rotate the on-chain anchor key
#                        mtls           regenerate MINFI mTLS certs
#                        operator <user> reset a specific operator's
#                                       Keycloak credentials + YubiKey
#                        architect-handover   for IR-05 — tied to the
#                                       backup-architect playbook.
#
# Logs every rotation as `audit.actions` row with action="key.rotate.<subsystem>".
set -euo pipefail

case "${1:-prompt}" in
  prompt)
    cat <<'EOF' | mail -s "[VIGIL APEX] Quarterly key-rotation due" satoshinakamotobull@gmail.com
The quarterly key-rotation timer has fired. Please:

  1. YubiKey ceremony (HSK-v1 §07) — physically rotate the architect
     and council-decryptor PIV keys.
  2. Run: sudo /usr/local/bin/vigil-key-rotation vault-tokens
  3. Run: sudo /usr/local/bin/vigil-key-rotation mtls
  4. (Optional, every 4 quarters) sudo /usr/local/bin/vigil-key-rotation polygon-wallet

Each step is recorded in audit.actions and verifiable on /verify and
in Grafana → vigil-audit-chain.
EOF
    # Also surface as a low-severity AlertManager warning so the
    # operator sees it on the dashboard within minutes.
    curl -fsS -X POST "${ALERTMANAGER_URL:-http://vigil-alertmanager:9093}/api/v2/alerts" \
      -H 'content-type: application/json' \
      -d '[{"labels":{"alertname":"KeyRotationDue","severity":"warning","service":"hsk"}}]' || true
    ;;

  vault-tokens)
    sudo /usr/local/sbin/06-vault-policies.sh
    psql -U vigil -d vigil -c "INSERT INTO audit.actions (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash) SELECT gen_random_uuid(), COALESCE((SELECT MAX(seq) FROM audit.actions),0)+1, 'key.rotate.vault-tokens', '${USER}', 'system', 'vault', NOW(), '{}'::jsonb, (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1), digest(NOW()::text || 'rotate', 'sha256');"
    ;;

  mtls)
    /usr/local/sbin/regen-mtls-certs.sh   # provisioned per host
    ;;

  polygon-wallet)
    cat <<'EOF' >&2
Polygon wallet rotation requires the council ceremony per SRD §17.7 —
this script does not automate it. Steps:

  1. New YubiKey enrolled in PIV slot 9c (HSK §05)
  2. Old key signs `transferAuthority(newKey)` on VIGILAnchor.sol
  3. `vigil-polygon-signer` reloaded with new YUBIKEY_PIV_LABEL
  4. Audit-row appended manually.
EOF
    exit 1
    ;;

  operator)
    user="${2:?operator <username> required}"
    docker exec vigil-keycloak /opt/keycloak/bin/kcadm.sh \
      reset-credentials -r vigil --username "${user}" --temporary
    psql -U vigil -d vigil -c "INSERT INTO audit.actions (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash) SELECT gen_random_uuid(), COALESCE((SELECT MAX(seq) FROM audit.actions),0)+1, 'key.rotate.operator', '${USER}', 'operator', '${user}', NOW(), '{}'::jsonb, (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1), digest(NOW()::text || '${user}', 'sha256');"
    ;;

  architect-handover)
    /usr/local/sbin/architect-handover.sh   # invoked from IR-05
    ;;

  *)
    echo "Usage: $0 {prompt|vault-tokens|mtls|polygon-wallet|operator <user>|architect-handover}" >&2
    exit 64
    ;;
esac
