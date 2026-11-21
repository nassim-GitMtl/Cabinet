-- Runs once when the volume is first created.
-- cabinet_owner (superuser in dev) owns the schema and runs migrations.
-- cabinet_app is the runtime role: NOT superuser, NO BYPASSRLS, so row-level
-- security policies are always enforced for application queries.
CREATE ROLE cabinet_app LOGIN PASSWORD 'cabinet_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- cabinet_sync applies rows copied between a clinic computer and the cloud copy (also NO BYPASSRLS).
CREATE ROLE cabinet_sync LOGIN PASSWORD 'cabinet_sync_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
CREATE DATABASE cabinet_test OWNER cabinet_owner;
-- Plays the clinic computer in the offline-sync integration tests.
CREATE DATABASE cabinet_test_peer OWNER cabinet_owner;
GRANT CONNECT ON DATABASE cabinet TO cabinet_app;
GRANT CONNECT ON DATABASE cabinet_test TO cabinet_app;
