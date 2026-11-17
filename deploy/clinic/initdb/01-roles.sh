#!/bin/sh
# Runs once, when the database volume is created. The application connects as
# cabinet_app: not superuser and NO BYPASSRLS, so row-level security always applies.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE cabinet_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO cabinet_app;
EOSQL
