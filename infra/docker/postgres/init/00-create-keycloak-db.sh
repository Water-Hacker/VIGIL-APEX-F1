#!/usr/bin/env sh
# Create the keycloak DB inside the same Postgres instance — saves a container.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE keycloak OWNER vigil ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;
EOSQL
