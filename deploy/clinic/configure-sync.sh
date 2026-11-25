#!/bin/sh
# Runs after migrations on every install/update. Migration 0043 creates the
# NOLOGIN role; this step gives the clinic-only sync process its own login and
# marks this database as a clinic node.
set -eu

psql -v ON_ERROR_STOP=1 \
  --host "${PGHOST:-db}" \
  --username "${PGUSER:-cabinet_owner}" \
  --dbname "${PGDATABASE:-cabinet}" \
  --set sync_password="$DB_SYNC_PASSWORD" <<'EOSQL'
SELECT format(
  'ALTER ROLE cabinet_sync WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
  :'sync_password'
) \gexec

GRANT cabinet_app TO cabinet_sync;
REVOKE ALL ON SCHEMA public FROM cabinet_sync;

UPDATE app_private.node_settings
   SET node_role = 'clinic', updated_at = now()
 WHERE singleton AND node_role <> 'clinic';

DO $$
DECLARE
  unsafe boolean;
  app_memberships integer;
  all_memberships integer;
BEGIN
  SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
    INTO unsafe FROM pg_roles WHERE rolname = 'cabinet_sync';
  IF unsafe IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'cabinet_sync has unsafe attributes';
  END IF;

  SELECT count(*) INTO app_memberships
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
   WHERE member.rolname = 'cabinet_sync' AND parent.rolname = 'cabinet_app';
  SELECT count(*) INTO all_memberships
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
   WHERE member.rolname = 'cabinet_sync';
  IF app_memberships <> 1 OR all_memberships <> 1 THEN
    RAISE EXCEPTION 'cabinet_sync must inherit only cabinet_app';
  END IF;

  IF app_private.node_role() <> 'clinic' THEN
    RAISE EXCEPTION 'clinic database node role was not configured';
  END IF;
END $$;
EOSQL
