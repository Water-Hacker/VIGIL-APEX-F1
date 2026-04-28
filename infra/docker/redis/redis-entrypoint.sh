#!/bin/sh
# Render /etc/redis/users.acl from the template + secret, then exec redis-server.
# Runs inside the official redis:7.4-alpine image (no bash needed).
set -eu

TEMPLATE="/etc/redis/users.acl.template"
ACL_FILE="/etc/redis/users.acl"
SECRET_FILE="${REDIS_PASSWORD_FILE:-/run/secrets/redis_password}"

if [ ! -f "${SECRET_FILE}" ]; then
  echo "[fatal] redis password secret not present at ${SECRET_FILE}" >&2
  exit 1
fi

PASSWORD="$(cat "${SECRET_FILE}")"
if [ -z "${PASSWORD}" ]; then
  echo "[fatal] redis password file is empty" >&2
  exit 2
fi

# Substitute without shelling out to sed-with-embedded-secrets (which can leak
# via /proc/<pid>/cmdline). awk reads stdin, never gets the password on argv.
PASSWORD="${PASSWORD}" awk '
  { gsub(/__VIGIL_REDIS_PASSWORD__/, ENVIRON["PASSWORD"]); print }
' "${TEMPLATE}" > "${ACL_FILE}"
chmod 0600 "${ACL_FILE}"
unset PASSWORD

exec redis-server "$@"
