-- Custom SQL migration file, put your code below! --
-- How many migrations this database has applied. Lets a deployment refuse to go live on a database that is behind
-- its code (scripts/check-schema.ts) instead of failing at runtime. Exposes no data, only a number.
CREATE OR REPLACE FUNCTION app_private.schema_migrations_applied() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*)::int FROM drizzle.__drizzle_migrations $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.schema_migrations_applied() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.schema_migrations_applied() TO cabinet_app;
--> statement-breakpoint
SELECT app_private.apply_security();
